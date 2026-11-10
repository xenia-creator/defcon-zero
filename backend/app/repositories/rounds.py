"""Database queries for the rounds table. All queries live in repositories."""

from typing import Any

from sqlalchemy import exists, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.round import Round


async def create_round_if_missing(
    db: AsyncSession, number: int, game: str, config: dict[str, Any], cut: int
) -> bool:
    """Insert a round unless its number exists. Returns True if it was inserted.

    ON CONFLICT DO NOTHING asks Postgres to skip the row if uq_rounds_number
    would refuse it. Checking first in Python would leave a gap where two runs
    both see the round as missing, and the second would crash on the constraint.

    An existing row is left exactly as it is, so a re-run during the event
    cannot reset a round that is already open. RETURNING gives back the new id
    only when a row was inserted, which is how the two cases are told apart.
    status is not set here: the column's default makes every new round waiting.
    """
    statement = (
        insert(Round)
        .values(number=number, game=game, config=config, cut=cut)
        .on_conflict_do_nothing(constraint="uq_rounds_number")
        .returning(Round.id)
    )
    result = await db.execute(statement)
    return result.scalar_one_or_none() is not None


async def list_rounds(db: AsyncSession) -> list[Round]:
    """Return every round in event order."""
    result = await db.execute(select(Round).order_by(Round.number))
    return list(result.scalars())


async def get_by_id(db: AsyncSession, round_id: int) -> Round | None:
    """Return the round with this id, or None if there is no such round."""
    result = await db.execute(select(Round).where(Round.id == round_id))
    return result.scalar_one_or_none()


async def get_round_for_update(db: AsyncSession, round_id: int) -> Round | None:
    """Return a round and lock its row until the transaction ends, or None.

    FOR UPDATE makes any other transaction asking for the same lock wait here.
    populate_existing makes SQLAlchemy use the row Postgres returns after that
    wait, in place of any older copy this session already holds.
    """
    result = await db.execute(
        select(Round)
        .where(Round.id == round_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_number(db: AsyncSession, round_id: int) -> int | None:
    """Return the number of the round with this id, or None if there is no such round."""
    result = await db.execute(select(Round.number).where(Round.id == round_id))
    return result.scalar_one_or_none()


async def lock_rounds_by_number(db: AsyncSession, numbers: list[int]) -> list[Round]:
    """Lock the rounds with these numbers until the transaction ends, in number order.

    For an action that must read neighbouring rounds as well as change one, such
    as editing a cut. Numbers that do not exist are skipped.

    Every row is taken in one statement, in number order: Postgres sorts the rows
    before it locks them. Two requests that both need rounds 1 and 2 then queue
    for round 1 first, so neither can hold one row while waiting for the other,
    which is how a deadlock happens.
    """
    result = await db.execute(
        select(Round)
        .where(Round.number.in_(numbers))
        .order_by(Round.number)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_round_for_share(db: AsyncSession, round_id: int) -> Round | None:
    """Return a round, holding a shared lock until the transaction ends, or None.

    FOR SHARE lets any number of readers hold it at once, so teams submitting
    together do not queue behind each other. It does block FOR UPDATE, so an
    organiser's start waits for submits in progress, and a submit that arrives
    during a start waits and then sees the round as running.
    """
    result = await db.execute(
        select(Round)
        .where(Round.id == round_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def has_unpublished_round_before(db: AsyncSession, number: int) -> bool:
    """Return True if any lower-numbered round is not published yet."""
    result = await db.execute(
        select(
            exists().where(Round.number < number, Round.status != "published")
        )
    )
    return result.scalar_one()


async def get_latest_started_round(db: AsyncSession) -> Round | None:
    """Return the highest-numbered round that has left waiting, or None."""
    result = await db.execute(
        select(Round)
        .where(Round.status != "waiting")
        .order_by(Round.number.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_running_ids(db: AsyncSession) -> list[int]:
    """Return the ids of rounds left running, in event order."""
    result = await db.execute(
        select(Round.id).where(Round.status == "running").order_by(Round.number)
    )
    return list(result.scalars())


async def set_run_error_if_running(db: AsyncSession, round_id: int, message: str) -> None:
    """Record why a round's run failed, but only if the round is still running.

    The status test is in the UPDATE itself, so it is checked by Postgres at the
    moment of writing. A round that something else already moved on, such as a
    reset back to waiting, is left alone rather than given a stale error.
    """
    await db.execute(
        update(Round)
        .where(Round.id == round_id, Round.status == "running")
        .values(run_error=message)
    )


async def clear_run_error(db: AsyncSession, round_id: int) -> None:
    """Forget a round's last run failure, as a new run is about to play it."""
    await db.execute(update(Round).where(Round.id == round_id).values(run_error=None))


async def get_latest_started_round_for_share(db: AsyncSession) -> Round | None:
    """Like get_latest_started_round, but holding a shared lock until the transaction ends.

    For a team status change, which must not run alongside a publish or the end
    of a run, as both of those read team statuses. FOR SHARE blocks their
    FOR UPDATE but not other readers, so submits do not queue behind it.
    """
    result = await db.execute(
        select(Round)
        .where(Round.status != "waiting")
        .order_by(Round.number.desc())
        .limit(1)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_first_round(db: AsyncSession) -> Round | None:
    """Return the lowest-numbered round, or None if no rounds exist yet."""
    result = await db.execute(select(Round).order_by(Round.number).limit(1))
    return result.scalar_one_or_none()
