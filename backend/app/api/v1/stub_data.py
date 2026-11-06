"""Hardcoded fake responses for the stub routes.

TEMPORARY. These let the frontend build against real contract shapes before the
database exists. They live in one file so that replacing the stubs with services
means deleting this file. Building them as schema objects means a shape that
drifts from the schemas fails at startup, not in the frontend.

Values are copied from the examples in docs/api.md where it has them.
"""

from datetime import UTC, datetime, timedelta

from app.schemas.auth import LoginResponse
from app.schemas.rounds import Round, RoundConfig, RoundsResponse
from app.schemas.standings import NationStanding, StandingsResponse
from app.schemas.submissions import (
    Blocks,
    SampleBotResult,
    Submission,
    SubmissionCheck,
    SubmissionsResponse,
    SubmissionSummary,
)
from app.schemas.teams import TeamProfile

# One frozen clock for every response. It never ticks, so a frontend timer will
# show a constant 24m 45s until real data arrives. It falls after the fake
# submission's created_at and before the fake round's closes_at.
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

FAKE_WAITING_ROUND = Round(
    id=2,
    number=2,
    game="theatre_of_war",
    status="waiting",
    opens_at=None,
    closes_at=None,
    config=RoundConfig(
        moves=["ATTACK", "DEFEND", "EXPAND"],
        max_modules=3,
        block_limit=40,
        rounds_per_match=200,
        repetitions=5,
    ),
    server_time=FAKE_SERVER_TIME,
)

FAKE_ROUNDS = RoundsResponse(
    rounds=[FAKE_OPEN_ROUND, FAKE_WAITING_ROUND],
    server_time=FAKE_SERVER_TIME,
)

# model_copy reuses the round above and changes only what each action changes,
# so the organiser buttons show the status moving through the contract's order.
FAKE_EXTENDED_ROUND = FAKE_OPEN_ROUND.model_copy(
    update={"closes_at": FAKE_OPEN_ROUND.closes_at + timedelta(minutes=10)}
)
FAKE_RUNNING_ROUND = FAKE_OPEN_ROUND.model_copy(update={"status": "running"})
FAKE_PUBLISHED_ROUND = FAKE_OPEN_ROUND.model_copy(update={"status": "published"})

# The pending and accepted fakes share id 42 so the contract's flow works from
# end to end: POST returns pending, then polling that id returns accepted.
FAKE_PENDING_SUBMISSION = Submission(
    id=42,
    round_id=1,
    version=4,
    status="pending",
    created_at=datetime(2026, 11, 12, 10, 20, 11, tzinfo=UTC),
    code='def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else "C"\n',
    blocks=Blocks(modules=[{"...": "Blockly workspace JSON"}]),
    check=None,
    server_time=FAKE_SERVER_TIME,
)

FAKE_ACCEPTED_SUBMISSION = FAKE_PENDING_SUBMISSION.model_copy(
    update={
        "status": "accepted",
        "check": SubmissionCheck(
            error=None,
            test_results=[
                SampleBotResult(opponent="always_cooperate", my_score=600, opp_score=0),
                SampleBotResult(opponent="tit_for_tat", my_score=600, opp_score=600),
            ],
        ),
    }
)

FAKE_SUBMISSIONS = SubmissionsResponse(
    submissions=[
        SubmissionSummary(
            id=42,
            version=4,
            status="accepted",
            created_at=datetime(2026, 11, 12, 10, 20, 11, tzinfo=UTC),
        ),
        SubmissionSummary(
            id=39,
            version=3,
            status="rejected",
            created_at=datetime(2026, 11, 12, 10, 14, 2, tzinfo=UTC),
        ),
    ],
    server_time=FAKE_SERVER_TIME,
)

FAKE_STANDINGS = StandingsResponse(
    round_id=1,
    round_status="published",
    nations=[
        NationStanding(
            team_id=7,
            nation_name="Red Dawn",
            territory_code="RU",
            status="active",
            score=3120,
            rank=1,
        )
    ],
    server_time=FAKE_SERVER_TIME,
)
