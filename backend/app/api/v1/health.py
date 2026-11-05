"""GET /health: lets a person or a load balancer check the server is up.

The contract makes this a public route (docs/api.md section 10), so it must
stay outside the token check when auth is added.
"""

from fastapi import APIRouter

from app.api.v1.stub_data import FAKE_HEALTH
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health")
async def get_health() -> HealthResponse:
    return FAKE_HEALTH
