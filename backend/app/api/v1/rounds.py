"""Routes for reading rounds (docs/api.md section 4)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.database import get_db
from app.schemas.rounds import Round, RoundsResponse
from app.services import rounds as rounds_service

router = APIRouter(prefix="/rounds", tags=["rounds"])


@router.get("")
async def list_rounds(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoundsResponse:
    # `user` is unused in the body. Declaring it is what requires a valid token.
    return await rounds_service.list_rounds(db)


@router.get("/current")
async def get_current_round(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.get_current_round(db)
