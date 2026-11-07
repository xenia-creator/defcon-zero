"""Route for the war map feed (docs/api.md section 6)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.database import get_db
from app.schemas.standings import StandingsResponse
from app.services import standings as standings_service

router = APIRouter(tags=["standings"])


# Any logged-in user, as the contract needs a token on every route except login
# and health. Results are already public once published, so the role does not
# matter here.
@router.get("/standings")
async def get_standings(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StandingsResponse:
    return await standings_service.get_standings(db)
