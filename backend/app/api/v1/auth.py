"""Routes for login and the current user (docs/api.md section 2).

How every router in this folder works:
- An APIRouter is a group of routes that main.py attaches to the app, so each
  feature can live in its own file.
- A parameter typed as a Pydantic model is read from the JSON body and validated
  before the function runs. Failures never reach the function; they become
  400 VALIDATION_ERROR in core/errors.py.
- The return type annotation is the response schema. FastAPI validates and
  serialises the result through it, so a route cannot leak extra fields.
- Routes are `async def` because the database layer is async. Routes that are
  still stubs ignore their inputs: nothing is checked and auth is not enforced.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.database import get_db
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.teams import TeamProfile
from app.services import auth as auth_service
from app.services import teams as teams_service

router = APIRouter(tags=["auth"])


@router.post("/auth/login")
async def login(
    credentials: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    return await auth_service.login(db, credentials.username, credentials.password)


@router.get("/me")
async def get_me(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TeamProfile:
    return await teams_service.get_profile(db, user)
