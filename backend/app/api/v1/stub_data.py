"""Hardcoded fake responses for the stub routes.

TEMPORARY. These let the frontend build against real contract shapes before the
database exists. They live in one file so that replacing the stubs with services
means deleting this file. Building them as schema objects means a shape that
drifts from the schemas fails at startup, not in the frontend.

Values are copied from the examples in docs/api.md where it has them.
"""

from datetime import UTC, datetime

from app.schemas.auth import LoginResponse
from app.schemas.rounds import Round, RoundConfig
from app.schemas.teams import TeamProfile

# One frozen clock for every response. It never ticks, so a frontend timer will
# show a constant 24m 45s until real data arrives. It falls before the fake
# round's closes_at.
FAKE_SERVER_TIME = datetime(2026, 11, 12, 10, 20, 15, tzinfo=UTC)

FAKE_LOGIN = LoginResponse(
    access_token="fake.stub.token",
    token_type="bearer",
    role="team",
    team_id=7,
)

FAKE_TEAM = TeamProfile(
    id=7,
    team_id=7,
    username="team_kremlin",
    role="team",
    nation_name="Red Dawn",
    territory_code="RU",
    status="active",
)

FAKE_DISQUALIFIED_TEAM = FAKE_TEAM.model_copy(update={"status": "disqualified"})

FAKE_OPEN_ROUND = Round(
    id=1,
    number=1,
    game="prisoners_dilemma",
    status="open",
    opens_at=datetime(2026, 11, 12, 10, 0, 0, tzinfo=UTC),
    closes_at=datetime(2026, 11, 12, 10, 45, 0, tzinfo=UTC),
    config=RoundConfig(
        moves=["C", "D"],
        max_modules=3,
        block_limit=40,
        rounds_per_match=200,
        repetitions=5,
    ),
    server_time=FAKE_SERVER_TIME,
)

# model_copy reuses the round above and changes only what publishing changes.
FAKE_PUBLISHED_ROUND = FAKE_OPEN_ROUND.model_copy(update={"status": "published"})
