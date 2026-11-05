"""Schemas for teams and territories (docs/api.md sections 2, 3 and 7)."""

from typing import Literal

from pydantic import BaseModel

from app.schemas.auth import Role

TeamStatus = Literal["active", "eliminated", "disqualified"]


class TeamProfile(BaseModel):
    """Body of GET /me, POST /teams/claim and PATCH /admin/teams/{id}, which the contract makes identical."""

    id: int
    username: str
    role: Role
    # `str | None` with no default: the key is always present in the JSON and
    # is null until claimed. The contract wants null, not a missing key.
    nation_name: str | None
    territory_code: str | None
    status: TeamStatus


class ClaimRequest(BaseModel):
    territory_code: str
    nation_name: str


class Territory(BaseModel):
    territory_code: str
    claimed: bool
    nation_name: str | None


class TerritoriesResponse(BaseModel):
    territories: list[Territory]


class TeamStatusUpdate(BaseModel):
    """Body of PATCH /admin/teams/{id}."""

    status: TeamStatus
