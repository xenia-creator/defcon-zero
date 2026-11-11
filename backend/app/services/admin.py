"""Business rules for GET /admin/overview, the organiser console's feed.

Organisers see every team's latest submission and the current round's scores in
every state, including running and review, when GET /standings still hides them.
The console polls this every few seconds, so it is built from a handful of
queries, each covering every team at once, never one query per team.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.round import Round as RoundRow
from app.repositories import rounds as rounds_repository
from app.repositories import standings as standings_repository
from app.repositories import submissions as submissions_repository
from app.repositories import teams as teams_repository
from app.repositories import users as users_repository
from app.schemas.admin import (
    AdminOverview,
    OverviewRound,
    OverviewSubmission,
    OverviewTeam,
    RunState,
)


async def get_overview_round(db: AsyncSession) -> RoundRow:
    """Return the current round, or round 1 before any round has started.

    The current round is the same one GET /rounds/current shows. Before the event
    there is none, but organisers still need the console, to see who has claimed
    and to open round 1, so it shows the round that will open next. Only an empty
    rounds table, before scripts/create_rounds.py has run, is a 404.
    """
    row = await rounds_repository.get_latest_started_round(db)
    if row is None:
        row = await rounds_repository.get_first_round(db)
    if row is None:
        raise AppError("NOT_FOUND", "No rounds have been created yet.", 404)
    return row


def count_test_wins(check: dict[str, Any] | None) -> tuple[int, int]:
    """Return (passed, total) from a stored check: test matches not lost, out of played.

    A match is passed when the bot scored at least as much as the sample bot, so
    a draw passes too. Counting only wins would show a cooperative bot such as
    tit for tat as 0/10, as it never outscores its opponent, only matches it.
    A check that has not finished is stored as null and counts as 0 out of 0.
    """
    if check is None:
        return 0, 0
    results = check["test_results"]
    passed = sum(result["my_score"] >= result["opp_score"] for result in results)
    return passed, len(results)


def build_submission(row: Any) -> OverviewSubmission:
    passed, total = count_test_wins(row.check)
    return OverviewSubmission(
        version=row.version,
        status=row.status,
        passed=passed,
        total=total,
        submitted_at=row.created_at,
    )


def run_state_of(round_row: RoundRow) -> RunState | None:
    """Whether a running round's matches are playing or its last run failed.

    Worked out from the stored failure rather than stored itself, so the two can
    never disagree. A round that is not running has no run, so both are null.
    """
    if round_row.status != "running":
        return None
    return "failed" if round_row.run_error is not None else "playing"


async def get_overview(db: AsyncSession) -> AdminOverview:
    """Return the GET /admin/overview body."""
    round_row = await get_overview_round(db)
    teams = await teams_repository.list_teams_with_usernames(db)
    submissions = {
        row.team_id: build_submission(row)
        for row in await submissions_repository.list_latest_in_round(db, round_row.id)
    }
    scores = await standings_repository.get_scores_for_round(db, round_row.id)
    return AdminOverview(
        round=OverviewRound(
            id=round_row.id,
            number=round_row.number,
            game=round_row.game,
            status=round_row.status,
            opens_at=round_row.opens_at,
            closes_at=round_row.closes_at,
            cut=round_row.cut,
            run_state=run_state_of(round_row),
            # Only shown while running. A stale error on a round that has moved
            # on cannot normally exist, but this keeps the two fields consistent.
            run_error=round_row.run_error if round_row.status == "running" else None,
        ),
        teams=[
            OverviewTeam(
                team_id=team.team_id,
                username=team.username,
                nation_name=team.nation_name,
                territory_code=team.territory_code,
                status=team.status,
                submission=submissions.get(team.team_id),
                # 0 before the round's results exist, and for a team that did
                # not enter the round, such as one knocked out earlier.
                score=scores.get(team.team_id, 0.0),
            )
            for team in teams
        ],
        unclaimed=await users_repository.list_unclaimed_team_usernames(db),
        server_time=datetime.now(UTC),
    )
