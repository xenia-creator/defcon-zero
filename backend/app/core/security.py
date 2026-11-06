"""Password hashing and login tokens.

This file holds the cryptography and nothing else. It knows nothing about HTTP
or the database, so the login service (which checks a password), the auth
dependencies (which read a token) and scripts/create_users.py (which hashes a
password) can all share it.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.settings import settings
from app.schemas.auth import Role

# HS256 signs a token with one shared secret, which suits us because this one
# server both creates and checks tokens.
JWT_ALGORITHM = "HS256"

# Long enough to cover a full event day without a team being logged out mid
# round, short enough that a leaked token stops working by the next day. There
# is no refresh route in the contract, so expiry simply means logging in again.
ACCESS_TOKEN_LIFETIME = timedelta(hours=12)

# Argon2 is deliberately slow and memory hungry, so guessing passwords from a
# leaked table is expensive. Passing the hasher explicitly keeps the algorithm
# visible here. pwdlib's default settings are used rather than hand-tuned ones.
password_hasher = PasswordHash((Argon2Hasher(),))


@dataclass(frozen=True)
class TokenClaims:
    """What a valid token tells us about who is calling."""

    user_id: int
    role: Role


def hash_password(password: str) -> str:
    """Turn a plain password into the Argon2 hash stored in users.password_hash.

    A hash is one-way: it cannot be turned back into the password. Argon2 also
    mixes in a random salt, so two users with the same password get different
    hashes, and the salt is stored inside the hash string itself.
    """
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return True if the plain password matches the stored hash.

    The hash cannot be reversed, so this repeats the hashing with the salt from
    the stored hash and compares the results.
    """
    return password_hasher.verify(password, password_hash)


def create_access_token(user_id: int, role: Role) -> str:
    """Create the signed token returned by POST /auth/login.

    A JWT is three base64 parts: header, claims and signature. Claims are the
    facts it carries. They are readable by anyone holding the token, so they
    must never contain a secret. What protects them is the signature: changing
    any claim breaks it, and only someone with JWT_SECRET can make a new one.

    `sub` (subject), `iat` (issued at) and `exp` (expires) are standard claim
    names, and `role` is our own. The JWT standard requires `sub` to be a
    string, so the integer user id is converted here and back again on decode.
    """
    issued_at = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "role": role,
        "iat": issued_at,
        "exp": issued_at + ACCESS_TOKEN_LIFETIME,
    }
    return jwt.encode(
        claims, settings.jwt_secret.get_secret_value(), algorithm=JWT_ALGORITHM
    )


def decode_access_token(token: str) -> TokenClaims:
    """Check a token and return its claims.

    Raises jwt.InvalidTokenError if the token is malformed, tampered with,
    expired or missing a claim. Expiry has its own subclass, but all of these
    become the same 401, so callers only need to catch the parent class.
    """
    claims = jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        # Only this algorithm is accepted. Otherwise an attacker could write
        # their own header choosing a weaker one, such as "none" (no signature).
        algorithms=[JWT_ALGORITHM],
        # PyJWT checks `exp` only when it is present, so a token without one
        # would never expire. Requiring these rejects any such token.
        options={"require": ["sub", "role", "exp"]},
    )
    return TokenClaims(user_id=parse_user_id(claims["sub"]), role=claims["role"])


def parse_user_id(subject: str) -> int:
    """Convert the `sub` claim back to an integer user id.

    Failing here is reported as a bad token, so that callers have only one kind
    of error to catch.
    """
    try:
        return int(subject)
    except ValueError as exc:
        raise jwt.InvalidTokenError("Token subject is not a user id.") from exc
