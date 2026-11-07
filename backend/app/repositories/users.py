"""Database queries for the users table. All queries live in repositories."""

from sqlalchemy import select, update
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


async def get_user_by_team_id(db: AsyncSession, team_id: int) -> User | None:
    """Return the user linked to this team, or None.

    There is at most one, as uq_users_team_id refuses a second.
    """
    result = await db.execute(select(User).where(User.team_id == team_id))
    return result.scalar_one_or_none()


async def list_unclaimed_team_usernames(db: AsyncSession) -> list[str]:
    """Return the usernames of team accounts with no team yet, in username order."""
    result = await db.execute(
        select(User.username)
        .where(User.role == "team", User.team_id.is_(None))
        .order_by(User.username)
    )
    return list(result.scalars())


async def set_password_hash(db: AsyncSession, username: str, password_hash: str) -> bool:
    """Replace this user's password hash. Return False if there is no such user.

    One UPDATE, with RETURNING to tell whether a row matched, so there is no gap
    between finding the user and changing them. Does not commit.
    """
    result = await db.execute(
        update(User)
        .where(User.username == username)
        .values(password_hash=password_hash)
        .returning(User.id)
    )
    return result.scalar_one_or_none() is not None
