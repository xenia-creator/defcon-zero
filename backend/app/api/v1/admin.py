"""Organiser routes (docs/api.md sections 4 and 7).

Every route here needs an organiser: CurrentOrganiser answers anyone else with
403 FORBIDDEN before the route runs.

The contract writes these paths with {id}. Naming it round_id or team_id changes
nothing in the URL and avoids shadowing Python's built-in id().
"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentOrganiser, PathId
from app.core.database import get_db
from app.schemas.admin import AdminOverview
from app.schemas.rounds import (
    ExtendRoundRequest,
    OpenRoundRequest,
    Round,
    SetTimeRequest,
    UpdateRoundRequest,
)
from app.schemas.teams import TeamProfile, TeamStatusUpdate
from app.services import admin as admin_service
from app.services import round_runs
from app.services import rounds as rounds_service
from app.services import teams as teams_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.patch("/rounds/{round_id}")
async def update_round(
    round_id: PathId,
    body: UpdateRoundRequest,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.update_round_cut(db, round_id, body.cut)


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


@router.post("/rounds/{round_id}/set-time")
async def set_round_time(
    round_id: PathId,
    body: SetTimeRequest,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.set_round_time(db, round_id, body.minutes)


@router.post("/rounds/{round_id}/start")
async def start_round(
    round_id: PathId,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
) -> Round:
    started = await rounds_service.start_round(db, round_id)
    # As with submission checks: the run is added only after the service has
    # committed, so it always finds the round running with its seed saved.
    background_tasks.add_task(round_runs.run_round, round_id)
    return started


@router.post("/rounds/{round_id}/retry")
async def retry_round(
    round_id: PathId,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
) -> Round:
    retried = await rounds_service.retry_round(db, round_id)
    background_tasks.add_task(round_runs.run_round, round_id)
    return retried


@router.post("/rounds/{round_id}/publish")
async def publish_round(
    round_id: PathId,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Round:
    return await rounds_service.publish_round(db, round_id)


@router.patch("/teams/{team_id}")
async def update_team_status(
    team_id: PathId,
    body: TeamStatusUpdate,
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TeamProfile:
    return await teams_service.set_team_status(db, team_id, body.status)


@router.get("/overview")
async def get_overview(
    organiser: CurrentOrganiser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminOverview:
    return await admin_service.get_overview(db)
