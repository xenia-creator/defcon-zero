"""GET /health: lets a person or a load balancer check the server and database are up.

The contract makes this a public route (docs/api.md section 10), so it must
stay outside the token check when auth is added.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.health import HealthResponse
from app.services.health import check_health

router = APIRouter(tags=["health"])


@router.get("/health")
async def get_health(db: Annotated[AsyncSession, Depends(get_db)]) -> HealthResponse:
    return await check_health(db)
