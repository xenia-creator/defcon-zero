"""Business rules for rounds: setting them up, reading them and moving them on."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rounds import (
    FINAL_ROUND_NUMBER,
    ROUND_DEFINITIONS,
    RoundDefinition,
)

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
            # The cut is left out of it: it has its own column, because organisers
            # change it during the event, and build_round puts it back in.
            definition.config.model_dump(exclude={"cut"}),
            definition.config.cut,
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
        # The cut has its own column but is shown with the round's other rules.
        config={**row.config, "cut": row.cut},
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


async def set_round_time(db: AsyncSession, round_id: int, minutes: int) -> Round:
    """Set an open round to close exactly this many minutes from now.

    Unlike extend, this ignores the current deadline, so it can shorten the
    window as well as lengthen it. It also works after the deadline has passed,
    when it reopens the window for that many minutes, as extend does.

    The lock is the same as extend's: two set-times at once take turns, and the
    last one to run decides the deadline. now is read after the lock, so a
    request that waited there counts from when it actually ran.
    """
    row = await lock_round_in_status(db, round_id, "open")
    now = datetime.now(UTC)
    row.closes_at = now + timedelta(minutes=minutes)
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
    # A fresh round has no failure, but a round reset by hand could carry one.
    row.run_error = None
    await db.commit()
    return build_round(row, now)


async def retry_round(db: AsyncSession, round_id: int) -> Round:
    """Accept a retry of a running round whose run crashed, and clear its failure.

    The router starts the run again once this returns. The failure is cleared
    here, in this commit, and not only when the run begins: the run starts after
    the response is sent, and the console refetches the overview straight after
    a retry, so it must already see the round as playing. The lock makes a retry
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
    row.run_error = None
    # The commit also releases the lock. FastAPI runs background tasks before it
    # closes the request's session, so a lock left open would make the run's own
    # save wait on it forever.
    await db.commit()
    return build_round(row, datetime.now(UTC))


def cut_refusal(
    row: RoundRow, cut: int, previous: RoundRow | None, next_: RoundRow | None
) -> str | None:
    """Return why this round cannot take this cut, or None if it can.

    Cuts must never grow from one round to the next, as a round cannot keep more
    teams than the round before it let through. So a cut is at most the previous
    round's and at least the next round's. A published next round would no longer
    limit it, though that cannot happen in practice: rounds publish in order, so
    this round would be published first, and the caller refuses that.

    The final round's cut is fixed: its rank 1 is the winner and its rank 2 the
    runner-up, the only two teams left active (docs/api.md section 4).
    """
    if row.number == FINAL_ROUND_NUMBER:
        return f"The final round's cut is fixed at {row.cut}."
    if previous is not None and cut > previous.cut:
        limit = f"so Round {row.number} can keep at most {previous.cut}"
        if previous.status == "published":
            return f"Round {previous.number} kept {previous.cut} teams, {limit}."
        return (
            f"Round {previous.number} keeps {previous.cut} teams, {limit}. "
            f"Raise Round {previous.number}'s cut first."
        )
    if next_ is not None and next_.status != "published" and cut < next_.cut:
        limit = f"so Round {row.number} must keep at least {next_.cut}"
        if next_.number == FINAL_ROUND_NUMBER:
            return f"The final round's cut is fixed at {next_.cut}, {limit}."
        return (
            f"Round {next_.number} keeps {next_.cut} teams, {limit}. "
            f"Lower Round {next_.number}'s cut first."
        )
    return None


async def update_round_cut(db: AsyncSession, round_id: int, cut: int) -> Round:
    """Set how many teams a round keeps at publish. Allowed until it is published.

    The rule depends on the rounds either side, so all three rows are locked,
    not just this one. Otherwise two edits at once could each pass against the
    other's old cut: round 1 lowered to 10 while round 2 is raised to 12, both
    allowed alone, would leave round 2 keeping more than round 1. The lock on this
    row also makes an edit and a publish of the same round take turns, so publish
    always applies the cut the organiser last saw saved.

    The number is read first, unlocked, to know which rows to lock. That is safe
    because a round's number never changes.
    """
    number = await rounds_repository.get_number(db, round_id)
    if number is None:
        raise AppError("NOT_FOUND", "This round does not exist.", 404)
    locked = {
        row.number: row
        for row in await rounds_repository.lock_rounds_by_number(
            db, [number - 1, number, number + 1]
        )
    }
    row = locked[number]
    if row.status == "published":
        raise AppError(
            "INVALID_ROUND_TRANSITION",
            "This round is published, so its cut has already been applied.",
            409,
        )
    refusal = cut_refusal(row, cut, locked.get(number - 1), locked.get(number + 1))
    if refusal is not None:
        raise AppError("VALIDATION_ERROR", refusal, 400)
    row.cut = cut
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

    N is the round's stored cut, which organisers may have changed since the
    round was created. It is read from the locked row, so an edit that arrives
    during a publish waits, then sees the round published and gets a 409.
    """
    row = await lock_round_in_status(db, round_id, "review")
    row.status = "published"
    await teams_repository.eliminate_outside_top(db, round_id, row.cut)
    await db.commit()
    return build_round(row, datetime.now(UTC))
