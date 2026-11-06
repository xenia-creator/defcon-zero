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


@router.get("/territories")
async def list_territories(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TerritoriesResponse:
    # `user` is unused in the body. Declaring it is what requires a valid token,
    # because the contract only leaves login and /health public.
    return await teams_service.list_territories(db)
