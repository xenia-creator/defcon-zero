"""Business rules for logging in, who is calling, and what they may do.

The auth router and the dependencies in api/dependencies.py call these functions.
Keeping the rules here leaves those files with only HTTP work, and means failures
are raised as AppError, which core/errors.py turns into the contract's error shape.
"""

import asyncio

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.repositories import users as users_repository
from app.schemas.auth import LoginResponse

# Checked against when the username does not exist, so that a login attempt takes
# the same time either way. See check_password below. Nobody can log in with it,
# because this path always fails whatever the result of the check.
DUMMY_PASSWORD_HASH = hash_password("no-account-has-this-password")


async def check_password(password: str, password_hash: str) -> bool:
    """Verify a password without freezing the server.

    Argon2 is slow on purpose, and it is CPU work, not a wait on the database.
    Run directly, it would stop this async server handling any other request
    until it finished. to_thread runs it on a separate thread instead, so a rush
    of logins does not stall every other team's polling.
    """
    return await asyncio.to_thread(verify_password, password, password_hash)


def invalid_credentials_error() -> AppError:
    return AppError("INVALID_CREDENTIALS", "Wrong username or password.", 401)


def normalise_username(username: str) -> str:
    """Return the one stored spelling of a username: all lowercase.

    Usernames are case-insensitive. Lowercasing both when an account is created
    and at login means "Team_A" and "team_a" are the same account, and the plain
    unique constraint on users.username is enough to enforce it.
    """
    return username.lower()


def is_usable_text(value: str) -> bool:
    """Return False for text that Postgres or Argon2 would crash on.

    JSON can carry a NUL character ("\\u0000") and half of a broken Unicode pair
    ("\\ud800"). Both pass Pydantic as ordinary strings. Postgres refuses them and
    the hasher cannot encode the second, so they would surface as a 500 error.
    """
    if "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


async def create_account(
    db: AsyncSession, username: str, password: str, role: str
) -> bool:
    """Add an account unless the username exists. Return True if it was added.

    An existing account is left exactly as it is, including its password. This
    does not commit, so the caller can save a whole batch at once.
    """
    return await users_repository.create_user_if_missing(
        db, normalise_username(username), hash_password(password), role
    )


async def login(db: AsyncSession, username: str, password: str) -> LoginResponse:
    """Check a username and password, and issue a token.

    A wrong username and a wrong password must look identical, otherwise an
    attacker could find out which usernames exist. That means the same error,
    and also the same time: skipping Argon2 for an unknown username would make
    those failures measurably faster. So a password is always checked.

    The early exit below is the one exception, and it reveals nothing: it depends
    only on what the caller typed, never on whether an account exists.
    """
    if not (is_usable_text(username) and is_usable_text(password)):
        raise invalid_credentials_error()

    user = await users_repository.get_user_by_username(
        db, normalise_username(username)
    )
    password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
    password_matches = await check_password(password, password_hash)

    if user is None or not password_matches:
        raise invalid_credentials_error()

    return LoginResponse(
        access_token=create_access_token(user.id, user.role),
        token_type="bearer",
        role=user.role,
        team_id=user.team_id,
    )


def unauthenticated_error() -> AppError:
    # One message for a missing, invalid or expired token, and for a user who no
    # longer exists. The contract has one code for all of them, and a caller
    # holding a bad token gains nothing from knowing which case it hit.
    return AppError("UNAUTHENTICATED", "Please log in again.", 401)


async def get_user_from_token(db: AsyncSession, token: str | None) -> User:
    """Return the user a token belongs to, or raise 401 UNAUTHENTICATED."""
    if token is None:
        raise unauthenticated_error()
    try:
        claims = decode_access_token(token)
    except jwt.InvalidTokenError as exc:
        raise unauthenticated_error() from exc

    # A valid signature only proves the user existed when the token was issued.
    # Loading the row catches an account deleted since then, and gives routes
    # current data. It costs one small primary key query per request.
    user = await users_repository.get_user_by_id(db, claims.user_id)
    if user is None:
        raise unauthenticated_error()
    return user


def ensure_team_account(user: User) -> None:
    """Raise 403 FORBIDDEN unless this user is a team account.

    Organisers run the event and do not play, so they cannot hold a territory.
    """
    if user.role != "team":
        raise AppError("FORBIDDEN", "Only teams can do this.", 403)


def ensure_organiser(user: User) -> None:
    """Raise 403 FORBIDDEN unless this user is an organiser.

    This reads the role from the database row, not from the token. A token keeps
    its role for up to 12 hours, so trusting it would leave someone removed as
    an organiser with admin access until it expired.
    """
    if user.role != "organiser":
        raise AppError("FORBIDDEN", "Only organisers can do this.", 403)
