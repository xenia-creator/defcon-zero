"""Stub routes for login and the current user (docs/api.md section 2).

How every router in this folder works:
- An APIRouter is a group of routes that main.py attaches to the app, so each
  feature can live in its own file.
- A parameter typed as a Pydantic model is read from the JSON body and validated
  before the function runs. Failures never reach the function; they become
  400 VALIDATION_ERROR in core/errors.py.
- The return type annotation is the response schema. FastAPI validates and
  serialises the result through it, so a route cannot leak extra fields.
- Routes are `async def` because the database layer will be async. Stubs ignore
  their inputs for now: nothing is checked, and no route enforces auth yet.
"""

from fastapi import APIRouter

from app.api.v1.stub_data import FAKE_LOGIN, FAKE_TEAM
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.teams import TeamProfile

router = APIRouter(tags=["auth"])


@router.post("/auth/login")
async def login(credentials: LoginRequest) -> LoginResponse:
    return FAKE_LOGIN


@router.get("/me")
async def get_me() -> TeamProfile:
    return FAKE_TEAM
