"""Tests for GET /admin/overview, the organiser console's feed (docs/api.md section 7)."""

import json
from collections.abc import Awaitable, Callable

import httpx

from tests.conftest import assert_error, create_user, run_sql
from tests.tournament_helpers import (
    ALWAYS_BETRAY,
    BAD_SYNTAX,
    TIT_FOR_TAT,
    ClaimedTeam,
    claim_teams,
    open_round,
    put_round_in_review,
    start_round,
    submit,
)

TEAM_KEYS = {
    "team_id", "username", "nation_name", "territory_code",
    "status", "is_bot", "submission", "score",
}


async def get_overview(client: httpx.AsyncClient, organiser: dict[str, str]) -> dict:
    response = await client.get("/admin/overview", headers=organiser)
    assert response.status_code == 200, response.text
    return response.json()


def team_row(overview: dict, team_id: int) -> dict:
    return next(team for team in overview["teams"] if team["team_id"] == team_id)


# --- Who can see it ---


async def test_overview_needs_a_token(client: httpx.AsyncClient) -> None:
    assert_error(await client.get("/admin/overview"), 401, "UNAUTHENTICATED")


async def test_teams_cannot_see_the_overview(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    round_ids: dict[int, int],
) -> None:
    headers = await log_in_new_user()

    assert_error(await client.get("/admin/overview", headers=headers), 403, "FORBIDDEN")


async def test_overview_is_404_before_any_round_exists(
    client: httpx.AsyncClient, organiser: dict[str, str]
) -> None:
    """Only before scripts/create_rounds.py has run. No round_ids fixture here."""
    assert_error(await client.get("/admin/overview", headers=organiser), 404, "NOT_FOUND")


# --- The shape ---


async def test_before_the_event_it_shows_round_1_and_every_team(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    await claimed_team("team_b", "BR", "Bravo")
    await claimed_team("team_a", "AR", "Alpha")

    overview = await get_overview(client, organiser)

    assert list(overview) == ["round", "teams", "unclaimed", "server_time"]
    assert overview["round"] == {
        "id": round_ids[1], "number": 1, "game": "prisoners_dilemma",
        "status": "waiting", "opens_at": None, "closes_at": None,
    }
    # Sorted by username, so the list does not jump around between polls.
    assert [team["username"] for team in overview["teams"]] == ["team_a", "team_b"]
    alpha = overview["teams"][0]
    assert set(alpha) == TEAM_KEYS
    assert alpha["nation_name"] == "Alpha" and alpha["territory_code"] == "AR"
    assert alpha["status"] == "active"
    assert alpha["is_bot"] is False
    assert alpha["submission"] is None
    assert alpha["score"] == 0.0


async def test_unclaimed_accounts_are_listed_by_username_and_not_in_teams(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    await claimed_team("team_claimed", "AR", "Alpha")
    await create_user("team_zulu")
    await create_user("team_bravo")

    overview = await get_overview(client, organiser)

    assert overview["unclaimed"] == ["team_bravo", "team_zulu"]
    assert [team["username"] for team in overview["teams"]] == ["team_claimed"]
    # Organisers are not team accounts, so they are in neither list.
    assert "boss" not in overview["unclaimed"]


async def test_round_is_the_current_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    await run_sql("UPDATE rounds SET status = 'published' WHERE number = 1")
    await open_round(client, organiser, round_ids[2])

    round_ = (await get_overview(client, organiser))["round"]

    assert (round_["id"], round_["number"], round_["game"], round_["status"]) == (
        round_ids[2], 2, "theatre_of_war", "open"
    )
    assert round_["opens_at"] is not None and round_["closes_at"] is not None


# --- submission ---


async def test_submission_is_the_latest_in_the_round_whatever_its_status(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    await open_round(client, organiser, round_ids[1])
    await submit(client, team.headers, round_ids[1], TIT_FOR_TAT)
    await submit(client, team.headers, round_ids[1], BAD_SYNTAX)

    submission = team_row(await get_overview(client, organiser), team.id)["submission"]

    rows = await run_sql(
        "SELECT created_at FROM submissions WHERE team_id = :id AND version = 2", id=team.id
    )
    assert set(submission) == {"version", "status", "passed", "total", "submitted_at"}
    assert submission["version"] == 2
    assert submission["status"] == "rejected"
    # A syntax error never ran, so it played no test matches.
    assert (submission["passed"], submission["total"]) == (0, 0)
    assert submission["submitted_at"].replace("Z", "+00:00") == rows[0][0].isoformat()


async def test_passed_counts_test_matches_won_or_drawn(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    check = {
        "error": None,
        "test_results": [
            {"opponent": "won", "my_score": 10.0, "opp_score": 2.0},
            {"opponent": "drew", "my_score": 5.0, "opp_score": 5.0},
            {"opponent": "lost", "my_score": 1.0, "opp_score": 9.0},
        ],
    }
    await run_sql(
        "INSERT INTO submissions (team_id, round_id, version, status, code, blocks, \"check\") "
        "VALUES (:team, :round, 1, 'accepted', 'x', '{}'::jsonb, CAST(:check AS jsonb))",
        team=team.id, round=round_ids[1], check=json.dumps(check),
    )

    submission = team_row(await get_overview(client, organiser), team.id)["submission"]

    assert (submission["passed"], submission["total"]) == (2, 3)


async def test_a_real_tit_for_tat_check_does_not_show_zero_passed(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """Tit for tat never outscores a sample bot, but it draws with the friendly ones."""
    [team] = await claim_teams(client, claimed_team, 1)
    await open_round(client, organiser, round_ids[1])
    await submit(client, team.headers, round_ids[1], TIT_FOR_TAT)

    submission = team_row(await get_overview(client, organiser), team.id)["submission"]

    assert submission["status"] == "accepted"
    assert submission["total"] > 0
    assert 0 < submission["passed"] <= submission["total"]


async def test_a_check_still_in_progress_shows_zero_of_zero(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    await run_sql(
        "INSERT INTO submissions (team_id, round_id, version, status, code, blocks) "
        "VALUES (:team, :round, 1, 'pending', 'x', '{}'::jsonb)",
        team=team.id, round=round_ids[1],
    )

    submission = team_row(await get_overview(client, organiser), team.id)["submission"]

    assert submission["status"] == "pending"
    assert (submission["passed"], submission["total"]) == (0, 0)


async def test_submissions_from_other_rounds_are_not_shown(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    await open_round(client, organiser, round_ids[1])
    await submit(client, team.headers, round_ids[1], TIT_FOR_TAT)
    await run_sql("UPDATE rounds SET status = 'published' WHERE number = 1")
    await open_round(client, organiser, round_ids[2])

    assert team_row(await get_overview(client, organiser), team.id)["submission"] is None


# --- score ---


async def test_scores_show_in_review_while_standings_hides_them(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    betrayer, cooperator = await claim_teams(client, claimed_team, 2)
    await open_round(client, organiser, round_ids[1])
    await submit(client, betrayer.headers, round_ids[1], ALWAYS_BETRAY)
    await submit(client, cooperator.headers, round_ids[1], TIT_FOR_TAT)
    await start_round(client, organiser, round_ids[1])

    overview = await get_overview(client, organiser)

    assert overview["round"]["status"] == "review"
    assert team_row(overview, betrayer.id)["score"] > team_row(overview, cooperator.id)["score"] > 0
    assert (await client.get("/standings")).json()["nations"] == []


async def test_score_is_this_rounds_score_and_zero_for_teams_not_in_it(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    played, knocked_out = (team.id for team in await claim_teams(client, claimed_team, 2))
    await put_round_in_review(round_ids[1], [played, knocked_out])
    await run_sql("UPDATE rounds SET status = 'published' WHERE number = 1")
    await put_round_in_review(round_ids[2], [played])

    overview = await get_overview(client, organiser)

    assert overview["round"]["number"] == 2
    # Round 2's score for the team in it, not its round 1 score. 0 for the other.
    assert team_row(overview, played)["score"] == 999.0
    assert team_row(overview, knocked_out)["score"] == 0.0
