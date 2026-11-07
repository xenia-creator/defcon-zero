"""Tests for GET /standings, the war map feed (docs/api.md section 6), and the
ranking rules behind its ranks, including tie breaks.
"""

import httpx

from app.services import engine_bridge, ranking
from tests.conftest import assert_error, bearer, run_sql
from tests.tournament_helpers import (
    ALWAYS_BETRAY,
    TIT_FOR_TAT,
    ClaimedTeam,
    claim_teams,
    match,
    open_round,
    put_round_in_review,
    start_round,
    submit,
)


async def test_standings_is_public(
    client: httpx.AsyncClient, organiser: dict[str, str], round_ids: dict[int, int]
) -> None:
    """No token is needed: the spectator war map shows it without logging in."""
    await client.post(
        f"/admin/rounds/{round_ids[1]}/open", json={"minutes": 30}, headers=organiser
    )

    response = await client.get("/standings")

    assert response.status_code == 200
    body = response.json()
    assert body["round_id"] == round_ids[1]
    assert body["round_status"] == "open"
    # Nothing is published yet, so there are no results to show.
    assert body["nations"] == []


async def test_standings_without_a_token_is_404_not_401_before_any_round(
    client: httpx.AsyncClient, round_ids: dict[int, int]
) -> None:
    """With no round started the answer is 404, the same as for a logged-in user."""
    assert_error(await client.get("/standings"), 404, "NOT_FOUND")


async def test_standings_ignores_a_bad_token(
    client: httpx.AsyncClient, organiser: dict[str, str], round_ids: dict[int, int]
) -> None:
    """A public route never reads the header, so a stale token is not a 401."""
    await client.post(
        f"/admin/rounds/{round_ids[1]}/open", json={"minutes": 30}, headers=organiser
    )

    response = await client.get("/standings", headers=bearer("not.a.token"))

    assert response.status_code == 200


# --- Review stays private ---


async def test_results_are_hidden_in_review_and_shown_once_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    teams = await claim_teams(client, claimed_team, 2)
    await open_round(client, organiser, round_ids[1])
    await submit(client, teams[0].headers, round_ids[1], ALWAYS_BETRAY)
    await submit(client, teams[1].headers, round_ids[1], TIT_FOR_TAT)
    await start_round(client, organiser, round_ids[1])

    in_review = (await client.get("/standings")).json()
    assert in_review["round_status"] == "review"
    assert in_review["nations"] == []

    await client.post(f"/admin/rounds/{round_ids[1]}/publish", headers=organiser)

    published = (await client.get("/standings")).json()
    assert published["round_status"] == "published"
    assert [n["team_id"] for n in published["nations"]] == [teams[0].id, teams[1].id]
    assert [n["rank"] for n in published["nations"]] == [1, 2]
    assert set(published["nations"][0]) == {
        "team_id", "nation_name", "territory_code", "status", "score", "rank"
    }
    assert published["nations"][0]["score"] > published["nations"][1]["score"] > 0


async def test_a_new_round_keeps_showing_the_last_published_results(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 3)]
    await put_round_in_review(round_ids[1], ranked)
    await client.post(f"/admin/rounds/{round_ids[1]}/publish", headers=organiser)
    round_1 = (await client.get("/standings")).json()["nations"]

    # Round 2 in review with a different order. None of it may show.
    await open_round(client, organiser, round_ids[2])
    await put_round_in_review(round_ids[2], list(reversed(ranked)))

    body = (await client.get("/standings")).json()
    assert body["round_id"] == round_ids[2]
    assert body["round_status"] == "review"
    assert body["nations"] == round_1


async def test_each_nation_shows_its_latest_published_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """A team knocked out in round 1 keeps its round 1 place under round 2's teams."""
    teams = [team.id for team in await claim_teams(client, claimed_team, 4)]
    await put_round_in_review(round_ids[1], teams)
    await run_sql("UPDATE rounds SET status = 'published' WHERE id = :id", id=round_ids[1])
    # Only the top two played round 2, in the opposite order.
    await put_round_in_review(round_ids[2], [teams[1], teams[0]])
    await run_sql("UPDATE rounds SET status = 'published' WHERE id = :id", id=round_ids[2])

    nations = (await client.get("/standings")).json()["nations"]

    assert [(n["team_id"], n["rank"]) for n in nations] == [
        (teams[1], 1), (teams[0], 2), (teams[2], 3), (teams[3], 4)
    ]
    # Round 2's scores for the two who played it, round 1's for the others.
    assert [n["score"] for n in nations] == [999.0, 998.0, 997.0, 996.0]


async def test_a_nation_with_no_published_result_is_left_out(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    played, late = (team.id for team in await claim_teams(client, claimed_team, 2))
    await put_round_in_review(round_ids[1], [played])
    await run_sql("UPDATE rounds SET status = 'published' WHERE id = :id", id=round_ids[1])

    nations = (await client.get("/standings")).json()["nations"]

    assert [n["team_id"] for n in nations] == [played]


async def test_status_is_the_teams_status_now(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 2)]
    await put_round_in_review(round_ids[1], ranked)
    await run_sql("UPDATE rounds SET status = 'published' WHERE id = :id", id=round_ids[1])

    await run_sql("UPDATE teams SET status = 'disqualified' WHERE id = :id", id=ranked[1])

    nations = (await client.get("/standings")).json()["nations"]
    assert [n["status"] for n in nations] == ["active", "disqualified"]


# --- Ranking and tie breaks (ranking.rank_round, as a run uses it) ---


def ranked_ids(results: list[ranking.TeamResult]) -> list[int]:
    return [result.team_id for result in results]


def test_teams_are_ranked_by_total_score() -> None:
    result = engine_bridge.RoundRobinResult(
        matches=[match(1, 2, 1, 4), match(1, 3, 2, 2), match(2, 3, 3, 9)],
        disqualified=[],
    )

    ranked = ranking.rank_round([1, 2, 3], [1, 2, 3], result, seed=1)

    assert ranked_ids(ranked) == [3, 2, 1]
    assert [r.score for r in ranked] == [11.0, 7.0, 3.0]
    assert [r.rank for r in ranked] == [1, 2, 3]


def test_a_tie_on_score_goes_to_the_head_to_head_winner() -> None:
    # 1 and 2 both total 10, but 2 beat 1 when they played.
    result = engine_bridge.RoundRobinResult(
        matches=[match(1, 2, 2, 4), match(1, 3, 8, 0), match(2, 3, 6, 1)],
        disqualified=[],
    )

    for seed in range(20):
        ranked = ranking.rank_round([1, 2, 3], [1, 2, 3], result, seed=seed)
        assert ranked_ids(ranked) == [2, 1, 3]


def test_head_to_head_counts_wins_over_every_repetition() -> None:
    # 1 wins two of three meetings with 2, and the totals are equal.
    result = engine_bridge.RoundRobinResult(
        matches=[
            match(1, 2, 3, 2, repetition=0),
            match(1, 2, 3, 2, repetition=1),
            match(1, 2, 0, 2, repetition=2),
        ],
        disqualified=[],
    )

    assert ranked_ids(ranking.rank_round([1, 2], [1, 2], result, seed=5)) == [1, 2]


def test_a_tie_with_drawn_head_to_heads_is_settled_by_the_seed() -> None:
    # Four teams, every match a draw: score and head to head cannot separate them.
    teams = [1, 2, 3, 4]
    matches = [match(a, b, 3, 3) for i, a in enumerate(teams) for b in teams[i + 1:]]
    result = engine_bridge.RoundRobinResult(matches=matches, disqualified=[])

    orders = {
        tuple(ranked_ids(ranking.rank_round(teams, teams, result, seed=seed)))
        for seed in range(30)
    }

    # The same seed always gives the same order, and different seeds differ.
    first = ranking.rank_round(teams, teams, result, seed=7)
    assert first == ranking.rank_round(teams, teams, result, seed=7)
    assert len(orders) > 1
    assert all(sorted(order) == teams for order in orders)


def test_uncounted_matches_add_no_score_and_win_no_head_to_head() -> None:
    # 1 and 2 tie on counted score. 1's big win over 2 was a forfeit, so it
    # does not count, and 2's counted win decides the tie.
    result = engine_bridge.RoundRobinResult(
        matches=[
            match(1, 2, 600, 0, counted=False),
            match(1, 2, 1, 2),
            match(1, 3, 5, 0),
            match(2, 3, 4, 0),
        ],
        disqualified=[],
    )

    ranked = ranking.rank_round([1, 2, 3], [1, 2, 3], result, seed=3)

    assert ranked_ids(ranked) == [2, 1, 3]
    assert [r.score for r in ranked] == [6.0, 6.0, 0.0]


def test_players_come_first_then_no_submission_then_disqualified() -> None:
    # 4 has no submission. 3 was disqualified, and its matches do not count.
    result = engine_bridge.RoundRobinResult(
        matches=[match(1, 2, 0, 5), match(1, 3, 0, 0, counted=False), match(2, 3, 0, 0, counted=False)],
        disqualified=[3],
    )

    ranked = ranking.rank_round([1, 2, 3, 4], [1, 2, 3], result, seed=9)

    assert ranked_ids(ranked) == [2, 1, 4, 3]
    # A player on 0 still ranks above a team that never played.
    assert ranked[1].score == 0.0


def test_move_to_bottom_moves_the_team_and_closes_the_gap() -> None:
    results = [ranking.TeamResult(team_id, 10.0 - rank, rank) for rank, team_id in enumerate([5, 6, 7, 8], 1)]

    moved = ranking.move_to_bottom(results, [6])

    assert [(r.team_id, r.rank) for r in moved] == [(5, 1), (7, 2), (8, 3), (6, 4)]
    assert {r.team_id: r.score for r in moved} == {r.team_id: r.score for r in results}
