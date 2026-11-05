"""Schemas for GET /standings, the war map feed (docs/api.md section 6)."""

from pydantic import AwareDatetime, BaseModel

from app.schemas.rounds import RoundStatus
from app.schemas.teams import TeamStatus


class NationStanding(BaseModel):
    team_id: int
    nation_name: str
    territory_code: str
    status: TeamStatus
    score: int
    rank: int


class StandingsResponse(BaseModel):
    round_id: int
    round_status: RoundStatus
    nations: list[NationStanding]
    server_time: AwareDatetime
