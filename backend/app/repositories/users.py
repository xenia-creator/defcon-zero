"""Database queries for the users table. All queries live in repositories."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def create_user_if_missing(
    db: AsyncSession, username: str, password_hash: str, role: str
) -> bool:
    """Insert a user unless the username exists. Return True if a row was added.

    ON CONFLICT DO NOTHING lets the database skip an existing username as part of
    the insert. RETURNING only gives back a row if one was really inserted, which
    is how the caller can tell the two cases apart.
    """
    result = await db.execute(
        insert(User)
        .values(username=username, password_hash=password_hash, role=role)
        .on_conflict_do_nothing(constraint="uq_users_username")
        .returning(User.id)
    )
    return result.scalar_one_or_none() is not None


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Return the user with this id, or None if there is no such user."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_for_update(db: AsyncSession, user_id: int) -> User | None:
    """Return this user with their row locked until the transaction ends.

    FOR UPDATE makes any other transaction asking for the same lock wait its
    turn. populate_existing replaces the copy this session already loaded while
    checking the token, which could be out of date by the time the lock is held.
    """
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    """Return the user with this username, or None if there is no such user.

    The match is exact, so callers pass the value from normalise_username in
    services/auth.py, which is the spelling that is stored.
    """
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()
