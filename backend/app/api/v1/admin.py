"""Organiser routes (docs/api.md sections 4 and 7).

Opening, extending and starting a round are real. Publishing a round and changing
a team's status are still stubs, but they already require an organiser.

The contract writes these paths with {id}. Naming it round_id or team_id changes
nothing in the URL and avoids shadowing Python's built-in id().
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentOrganiser, PathId
from app.api.v1.stub_data import FAKE_DISQUALIFIED_TEAM, FAKE_PUBLISHED_ROUND
from app.core.database import get_db
from app.schemas.rounds import ExtendRoundRequest, OpenRoundRequest, Round
from app.schemas.teams import TeamProfile, TeamStatusUpdate
from app.services import rounds as rounds_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/rounds/{round_id}/open")
async def open_round(
    round_id: PathId,
    body: OpenRoundRequest,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.open_round(db, round_id, body.minutes)


@router.post("/rounds/{round_id}/extend")
async def extend_round(
    round_id: PathId,
    body: ExtendRoundRequest,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.extend_round(db, round_id, body.minutes)


@router.post("/rounds/{round_id}/start")
async def start_round(
    round_id: PathId,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.start_round(db, round_id)


@router.post("/rounds/{round_id}/publish")
async def publish_round(round_id: PathId, organiser: CurrentOrganiser) -> Round:
    return FAKE_PUBLISHED_ROUND


@router.patch("/teams/{team_id}")
async def update_team_status(
    team_id: PathId, body: TeamStatusUpdate, organiser: CurrentOrganiser
) -> TeamProfile:
    return FAKE_DISQUALIFIED_TEAM
