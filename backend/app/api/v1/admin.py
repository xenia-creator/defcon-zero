"""Stub organiser routes (docs/api.md sections 4 and 7).

These live together so that one role check can later cover the whole router.
The stubs do not check the role or the round's current status yet.

The contract writes these paths with {id}. Naming it round_id or team_id changes
nothing in the URL and avoids shadowing Python's built-in id().
"""

from fastapi import APIRouter

from app.api.v1.stub_data import (
    FAKE_DISQUALIFIED_TEAM,
    FAKE_EXTENDED_ROUND,
    FAKE_OPEN_ROUND,
    FAKE_PUBLISHED_ROUND,
    FAKE_RUNNING_ROUND,
)
from app.schemas.rounds import ExtendRoundRequest, OpenRoundRequest, Round
from app.schemas.teams import TeamProfile, TeamStatusUpdate

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/rounds/{round_id}/open")
async def open_round(round_id: int, body: OpenRoundRequest) -> Round:
    return FAKE_OPEN_ROUND


@router.post("/rounds/{round_id}/extend")
async def extend_round(round_id: int, body: ExtendRoundRequest) -> Round:
    return FAKE_EXTENDED_ROUND


@router.post("/rounds/{round_id}/start")
async def start_round(round_id: int) -> Round:
    return FAKE_RUNNING_ROUND


@router.post("/rounds/{round_id}/publish")
async def publish_round(round_id: int) -> Round:
    return FAKE_PUBLISHED_ROUND


@router.patch("/teams/{team_id}")
async def update_team_status(team_id: int, body: TeamStatusUpdate) -> TeamProfile:
    return FAKE_DISQUALIFIED_TEAM
