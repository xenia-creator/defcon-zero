"""Shared route dependencies: who is calling, and are they allowed in.

A route opts in by declaring a parameter, and FastAPI runs the dependency before
the route body. If the dependency raises, the route never runs:

    async def get_me(user: CurrentUser) -> ...
    async def open_round(organiser: CurrentOrganiser) -> ...

This file only reads the HTTP request. The rules are in services/auth.py.
"""

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.services import auth as auth_service

# HTTPBearer reads "Authorization: Bearer <token>" and adds the Authorize button
# to the /docs page. auto_error=False stops it rejecting a bad header itself,
# because its error would not use the contract's shape. It gives us None instead,
# for a missing header and for any scheme other than Bearer.
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Return the logged-in user, or fail with 401 UNAUTHENTICATED."""
    token = credentials.credentials if credentials else None
    return await auth_service.get_user_from_token(db, token)


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_organiser(user: CurrentUser) -> User:
    """Return the logged-in organiser, or fail with 403 FORBIDDEN.

    It depends on get_current_user, so the token is checked first: no token is
    401 (who are you?), and a team's valid token is 403 (you may not do this).
    """
    auth_service.ensure_organiser(user)
    return user


CurrentOrganiser = Annotated[User, Depends(require_organiser)]
