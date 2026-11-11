"""Schemas for GET /admin/overview, the organiser console's feed (docs/api.md section 7)."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel

from app.schemas.rounds import Game, RoundStatus
from app.schemas.submissions import SubmissionStatus
from app.schemas.teams import TeamStatus


# Whether a running round's background run is still playing its matches, or
# failed and is waiting for an organiser to retry it (docs/api.md section 7, v5.6).
RunState = Literal["playing", "failed"]


class OverviewRound(BaseModel):
    """The round the console is showing. A cut-down Round object: no config.

    cut is the one setting it does carry, as the console shows and edits it.
    """

    id: int
    number: int
    game: Game
    status: RoundStatus
    opens_at: AwareDatetime | None
    closes_at: AwareDatetime | None
    cut: int
    # Both null unless status is running. run_error is the short reason the last
    # run failed, set only when run_state is failed. The status itself stays
    # running either way, so the round's status machine is unchanged.
    run_state: RunState | None
    run_error: str | None


class OverviewSubmission(BaseModel):
    """A team's latest submission in the round, whatever its status."""

    version: int
    status: SubmissionStatus
    # Test matches against the sample bots that this bot won or drew, out of
    # total. Both are 0 while the check has not finished.
    passed: int
    total: int
    submitted_at: AwareDatetime


class OverviewTeam(BaseModel):
    team_id: int
    username: str
    # Typed nullable as the contract has them. Only claimed teams are listed,
    # so in practice both are always set.
    nation_name: str | None
    territory_code: str | None
    status: TeamStatus
    # Always false. Literal[False] makes the schema refuse anything else, so a
    # future change cannot quietly send true.
    is_bot: Literal[False] = False
    submission: OverviewSubmission | None
    # This round's score, private to organisers until published. 0 before results.
    score: float


class AdminOverview(BaseModel):
    round: OverviewRound
    teams: list[OverviewTeam]
    # Usernames of team accounts that have not claimed a territory, so they have
    # no team row yet. Organisers use it to see who to chase before round 1.
    unclaimed: list[str]
    server_time: AwareDatetime
