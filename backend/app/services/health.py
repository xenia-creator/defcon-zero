"""Business rule behind GET /health: the app is healthy only if the database answers."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import health as health_repository
from app.schemas.health import HealthResponse


async def check_health(db: AsyncSession) -> HealthResponse:
    # The failure is deliberately not caught. docs/api.md has no "unhealthy" body
    # or 503 code, so it reaches catch_unexpected_errors in core/errors.py and
    # becomes a 500 INTERNAL_ERROR, which a load balancer also reads as down.
    await health_repository.ping(db)
    return HealthResponse(status="ok")
