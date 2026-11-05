"""Stub routes for reading rounds (docs/api.md section 4)."""

from fastapi import APIRouter

from app.api.v1.stub_data import FAKE_OPEN_ROUND, FAKE_ROUNDS
from app.schemas.rounds import Round, RoundsResponse

router = APIRouter(prefix="/rounds", tags=["rounds"])


@router.get("")
async def list_rounds() -> RoundsResponse:
    return FAKE_ROUNDS


@router.get("/current")
async def get_current_round() -> Round:
    return FAKE_OPEN_ROUND
