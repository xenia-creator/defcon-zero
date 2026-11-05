"""Stub routes for claiming a territory (docs/api.md section 3)."""

from fastapi import APIRouter

from app.api.v1.stub_data import FAKE_TEAM, FAKE_TERRITORIES
from app.schemas.teams import ClaimRequest, TeamProfile, TerritoriesResponse

router = APIRouter(tags=["teams"])


@router.post("/teams/claim")
async def claim_territory(claim: ClaimRequest) -> TeamProfile:
    return FAKE_TEAM


@router.get("/territories")
async def list_territories() -> TerritoriesResponse:
    return FAKE_TERRITORIES
