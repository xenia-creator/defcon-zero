"""Business rules for rounds: setting them up, reading them and moving them on."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rounds import ROUND_DEFINITIONS, TEAMS_KEPT_BY_ROUND_NUMBER, RoundDefinition

# Renamed because the table's class and the API's schema are both called Round.
from app.models.round import Round as RoundRow
from app.repositories import rounds as rounds_repository
from app.repositories import teams as teams_repository
from app.schemas.rounds import Round, RoundsResponse
from app.services import round_runs


async def create_missing_rounds(
    db: AsyncSession,
) -> list[tuple[RoundDefinition, bool]]:
    """Add any round not in the table yet. Pairs each round with True if created.

    It does not commit, as in the rest of the app: the caller decides when the
    work is complete, so all three rounds are saved together or not at all.
    """
    results = []
    for definition in ROUND_DEFINITIONS:
        created = await rounds_repository.create_round_if_missing(
            db,
            definition.number,
            definition.game,
            # JSONB stores plain JSON, so the schema object becomes a dictionary.
            definition.config.model_dump(),
        )
        results.append((definition, created))
    return results


def build_round(row: RoundRow, server_time: datetime) -> Round:
    """Turn a table row into the API's Round object.

    server_time is passed in, not read here, so that every round in one response
    and the response itself all report the same moment.
    """
    return Round(
        id=row.id,
        number=row.number,
        game=row.game,
        status=row.status,
        opens_at=row.opens_at,
        closes_at=row.closes_at,
        config=row.config,
        server_time=server_time,
    )


async def list_rounds(db: AsyncSession) -> RoundsResponse:
    """Return the GET /rounds body."""
    server_time = datetime.now(UTC)
    rows = await rounds_repository.list_rounds(db)
    return RoundsResponse(
        rounds=[build_round(row, server_time) for row in rows],
        server_time=server_time,
    )


async def get_current_round(db: AsyncSession) -> Round:
    """Return the round the event is on, or 404 NOT_FOUND before the first opens.

    Rounds run in number order, so the current one is the highest-numbered round
    that has left waiting. A finished round stays current until the next one
    opens, which keeps its result on screen between rounds.
    """
    row = await rounds_repository.get_latest_started_round(db)
    if row is None:
        raise AppError("NOT_FOUND", "No round has started yet.", 404)
    return build_round(row, datetime.now(UTC))


async def lock_round_in_status(
    db: AsyncSession, round_id: int, required_status: str
) -> RoundRow:
    """Lock a round, then confirm it is in the status this action starts from.

    The order is what stops a double click. The second request waits at the lock
    until the first commits, so it reads the new status and gets a 409. Checking
    before locking would let both requests see the old status and both go ahead.
    Raising here ends the request, and closing the session releases the lock.
    """
    row = await rounds_repository.get_round_for_update(db, round_id)
    if row is None:
        raise AppError("NOT_FOUND", "This round does not exist.", 404)
    if row.status != required_status:
        raise AppError(
            "INVALID_ROUND_TRANSITION",
            f"This action needs the round to be {required_status}, "
            f"but it is {row.status}.",
            409,
        )
    return row


async def open_round(db: AsyncSession, round_id: int, minutes: int) -> Round:
    """Move a round from waiting to open, for the given number of minutes.

    Rounds go in order, and this one check is what keeps only one round open or
    running: every lower round must be published, and no higher round can have
    started, as it would have needed this one published first. The lower rounds
    need no lock, because published is the last status and cannot be undone.
    """
    row = await lock_round_in_status(db, round_id, "waiting")
    if await rounds_repository.has_unpublished_round_before(db, row.number):
        raise AppError(
            "INVALID_ROUND_TRANSITION",
            "Every earlier round must be published before this one can open.",
            409,
        )
    now = datetime.now(UTC)
    row.status = "open"
    row.opens_at = now
    row.closes_at = now + timedelta(minutes=minutes)
    await db.commit()
    return build_round(row, now)


async def extend_round(db: AsyncSession, round_id: int, minutes: int) -> Round:
    """Add minutes to the later of an open round's deadline and the time now.

    While the window is still running, the minutes go on the current deadline,
    so extending by 10 means 10 more than teams were promised. Once the deadline
    has passed, adding to it could leave it still in the past and the clock at
    00:00, so the minutes go on the time now instead: extend always gives teams
    real time. The lock also means two extends at once both count, instead of
    one overwriting the other.

    now is read after the lock, so a request that waited there uses the time it
    actually ran, and it is passed to build_round, as in open and start, so the
    response's server_time is the moment the deadline was worked out from.
    """
    row = await lock_round_in_status(db, round_id, "open")
    now = datetime.now(UTC)
    row.closes_at = max(row.closes_at, now) + timedelta(minutes=minutes)
    await db.commit()
    return build_round(row, now)


async def start_round(db: AsyncSession, round_id: int) -> Round:
    """Move a round from open to running, which closes the submission window.

    closes_at moves to now because the contract plays the latest submission
    created before closes_at, so it must stay true when a round starts early.

    The seed is chosen here, once, and saved with the status change, so every
    retry or resume of this round plays the same matches. The matches are not
    played here: the router starts round_runs.run_round once this has committed.
    """
    row = await lock_round_in_status(db, round_id, "open")
    now = datetime.now(UTC)
    row.status = "running"
    row.closes_at = now
    row.seed = round_runs.new_seed()
    await db.commit()
    return build_round(row, now)


async def retry_round(db: AsyncSession, round_id: int) -> Round:
    """Accept a retry of a running round whose run crashed. Changes nothing itself.

    The router starts the run again once this returns. The lock makes a retry
    that arrives as the run finishes wait, and then see review and get a 409.

    A round being run right now also gets a 409. That check is the polite answer
    for the organiser. Two retries a moment apart could both pass it, as the run
    starts after the response, and round_runs.run_round is what makes the second
    one do nothing.
    """
    row = await lock_round_in_status(db, round_id, "running")
    if round_runs.is_in_progress(round_id):
        raise AppError(
            "INVALID_ROUND_TRANSITION",
            "This round's matches are still being played.",
            409,
        )
    # Nothing changed, but the transaction must still end here to release the
    # lock. FastAPI runs background tasks before it closes the request's session,
    # so a lock left open would make the run's own save wait on it forever.
    await db.commit()
    return build_round(row, datetime.now(UTC))


async def publish_round(db: AsyncSession, round_id: int) -> Round:
    """Move a round from review to published, and apply the cut.

    Publishing is what makes the results public on GET /standings, and the cut
    is what decides who plays the next round, so both go in one commit. Nobody
    can see results whose eliminations have not happened, or the reverse.

    The cut follows the stored ranks, which already have every tie broken, so
    exactly the teams ranked 1 to N stay in. After the last round that leaves the
    winner at rank 1 and the runner-up at rank 2.
    """
    row = await lock_round_in_status(db, round_id, "review")
    row.status = "published"
    await teams_repository.eliminate_outside_top(
        db, round_id, TEAMS_KEPT_BY_ROUND_NUMBER[row.number]
    )
    await db.commit()
    return build_round(row, datetime.now(UTC))
