"""Route for the war map feed (docs/api.md section 6)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.standings import StandingsResponse
from app.services import standings as standings_service

router = APIRouter(tags=["standings"])


# Public, like /health: no CurrentUser, so no token is needed. The war map's
# spectator view shows it without logging in. That is safe because it only ever
# shows published results: the review-stays-private rule is in the query
# behind it, not in who is asking. A stale token is ignored, as on /territories.
@router.get("/standings")
async def get_standings(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StandingsResponse:
    return await standings_service.get_standings(db)
