"""Stub route for the war map feed (docs/api.md section 6)."""

from fastapi import APIRouter

from app.api.v1.stub_data import FAKE_STANDINGS
from app.schemas.standings import StandingsResponse

router = APIRouter(tags=["standings"])


@router.get("/standings")
async def get_standings() -> StandingsResponse:
    return FAKE_STANDINGS
