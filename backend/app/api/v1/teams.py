"""Routes for claiming a territory (docs/api.md section 3)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.database import get_db
from app.schemas.teams import ClaimRequest, TeamProfile, TerritoriesResponse
from app.services import teams as teams_service

router = APIRouter(tags=["teams"])


@router.post("/teams/claim")
async def claim_territory(
    claim: ClaimRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TeamProfile:
    return await teams_service.claim_territory(
        db, user, claim.territory_code, claim.nation_name
    )


# Public, like /health: no CurrentUser, so no token is needed. The war map's
# spectator view shows it without logging in, and it only reveals which
# territories are claimed and the nation names, which the map shows anyway.
# Without the dependency the Authorization header is never read, so a stale
# token from a logged-in browser is ignored rather than answered with 401.
@router.get("/territories")
async def list_territories(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TerritoriesResponse:
    return await teams_service.list_territories(db)
