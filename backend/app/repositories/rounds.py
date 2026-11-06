"""Database queries for the rounds table. All queries live in repositories."""

from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.round import Round


async def create_round_if_missing(
    db: AsyncSession, number: int, game: str, config: dict[str, Any]
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
        .values(number=number, game=game, config=config)
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
