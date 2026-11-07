"""Tests for PATCH /admin/teams/{id}, an organiser changing a team's status
(docs/api.md section 7), and how disqualifying or restoring a team re-ranks a
round in review.

Auth for this route (401 without a token, 403 for a team, 400 for an id out of
range) is covered with the other admin routes in test_rounds.py.
"""

import asyncio

import httpx
import pytest

from app.services import engine_bridge
from tests.conftest import assert_error, create_user, run_sql
from tests.tournament_helpers import (
    TIT_FOR_TAT,
    ClaimedTeam,
    claim_teams,
    match,
    open_round,
    put_round_in_review,
    round_ranks,
    start_round,
    store_round_results,
    submit,
    team_statuses,
)


async def patch_status(
    client: httpx.AsyncClient, organiser: dict[str, str], team_id: int, status: str
) -> httpx.Response:
    return await client.patch(
        f"/admin/teams/{team_id}", json={"status": status}, headers=organiser
    )


# --- The route itself ---


async def test_patch_returns_the_me_body_with_the_new_status(
    client: httpx.AsyncClient, organiser: dict[str, str], claimed_team: ClaimedTeam
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)

    response = await patch_status(client, organiser, team.id, "disqualified")

    assert response.status_code == 200
    me = (await client.get("/me", headers=team.headers)).json()
    # The same body as GET /me: the user id as id, and the team id as team_id.
    assert response.json() == me
    assert response.json()["team_id"] == team.id
    assert response.json()["status"] == "disqualified"


@pytest.mark.parametrize(
    "start,end",
    [
        ("active", "eliminated"),
        ("active", "disqualified"),
        ("eliminated", "active"),
        ("disqualified", "active"),
        ("eliminated", "disqualified"),
        ("disqualified", "eliminated"),
    ],
)
async def test_any_status_can_be_set_from_any_other(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    start: str,
    end: str,
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    await run_sql("UPDATE teams SET status = :s WHERE id = :id", s=start, id=team.id)

    response = await patch_status(client, organiser, team.id, end)

    assert response.status_code == 200
    assert (await team_statuses())[team.id] == end


async def test_patch_unknown_team_is_404(
    client: httpx.AsyncClient, organiser: dict[str, str]
) -> None:
    assert_error(await patch_status(client, organiser, 2_147_483_647, "active"), 404, "NOT_FOUND")


@pytest.mark.parametrize("body", [{"status": "winner"}, {"status": None}, {}, {"status": 1}])
async def test_patch_with_a_bad_status_is_400(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    body: dict,
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)

    response = await client.patch(f"/admin/teams/{team.id}", json=body, headers=organiser)

    assert_error(response, 400, "VALIDATION_ERROR")
    assert (await team_statuses())[team.id] == "active"


async def test_a_disqualified_team_cannot_submit(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    [team] = await claim_teams(client, claimed_team, 1)
    await open_round(client, organiser, round_ids[1])
    await patch_status(client, organiser, team.id, "disqualified")

    response = await client.post(
        "/submissions",
        json={"round_id": round_ids[1], "code": TIT_FOR_TAT, "blocks": {"modules": []}},
        headers=team.headers,
    )

    assert_error(response, 403, "TEAM_DISQUALIFIED")


async def test_an_unclaimed_account_has_no_team_to_patch(
    client: httpx.AsyncClient, organiser: dict[str, str]
) -> None:
    """The URL takes a team id, and an unclaimed account has none, so 404."""
    await create_user("team_unclaimed")
    rows = await run_sql("SELECT coalesce(max(id), 0) + 1 FROM teams")

    assert_error(await patch_status(client, organiser, rows[0][0], "active"), 404, "NOT_FOUND")


# --- Re-ranking a round in review ---


async def test_disqualifying_rank_1_in_review_lets_the_old_rank_16_advance(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 20)]
    await put_round_in_review(round_ids[1], ranked)
    old_rank_1, old_rank_16 = ranked[0], ranked[15]

    response = await patch_status(client, organiser, old_rank_1, "disqualified")
    assert response.status_code == 200

    # Re-ranked: the disqualified team is last, and every team below it moved up.
    ranks = await round_ranks(round_ids[1])
    assert ranks[old_rank_1] == 20
    assert [ranks[team_id] for team_id in ranked[1:]] == list(range(1, 20))

    published = await client.post(f"/admin/rounds/{round_ids[1]}/publish", headers=organiser)
    assert published.status_code == 200

    # The cut keeps exactly 15 teams that are not disqualified, so the old rank
    # 16 is in and the old rank 17 is out.
    statuses = await team_statuses()
    assert statuses[old_rank_1] == "disqualified"
    assert statuses[old_rank_16] == "active"
    assert [statuses[team_id] for team_id in ranked[1:16]] == ["active"] * 15
    assert [statuses[team_id] for team_id in ranked[16:]] == ["eliminated"] * 4
    assert sum(status == "active" for status in statuses.values()) == 15


async def test_restoring_a_disqualified_team_in_review_gives_back_its_place(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    team_ids = [team.id for team in await claim_teams(client, claimed_team, 6)]
    original = await store_round_results(round_ids[1], team_ids[:5], team_ids[5:])
    rank_3 = next(team_id for team_id, rank in original.items() if rank == 3)
    # Rank 3 must be one of the tied teams, so getting it back right depends on
    # the seeded tie-break, not just on scores.
    assert rank_3 not in (team_ids[0], team_ids[4])

    await patch_status(client, organiser, rank_3, "disqualified")
    assert (await round_ranks(round_ids[1]))[rank_3] == 6

    restored = await patch_status(client, organiser, rank_3, "active")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"
    # Back at rank 3, and every other team in its original place, including the
    # other tied teams and the team with no submission at the bottom.
    assert await round_ranks(round_ids[1]) == original


async def test_restoring_keeps_other_disqualified_teams_at_the_bottom(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    team_ids = [team.id for team in await claim_teams(client, claimed_team, 6)]
    original = await store_round_results(round_ids[1], team_ids[:5], team_ids[5:])
    by_rank = sorted(original, key=original.get)
    restored_team, still_out = by_rank[1], by_rank[0]

    await patch_status(client, organiser, restored_team, "disqualified")
    await patch_status(client, organiser, still_out, "disqualified")
    await patch_status(client, organiser, restored_team, "active")

    ranks = await round_ranks(round_ids[1])
    assert ranks[still_out] == 6
    # Everyone else keeps their original order, each moved up one place.
    others = [team_id for team_id in by_rank if team_id != still_out]
    assert [ranks[team_id] for team_id in others] == [1, 2, 3, 4, 5]


async def test_eliminating_a_team_in_review_does_not_change_the_ranks(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 4)]
    await put_round_in_review(round_ids[1], ranked)

    await patch_status(client, organiser, ranked[0], "eliminated")

    expected = {team_id: rank for rank, team_id in enumerate(ranked, start=1)}
    assert await round_ranks(round_ids[1]) == expected


async def test_disqualifying_after_publish_leaves_the_published_ranks(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """Published results are final. The map shows the new status, not a new rank."""
    ranked = [team.id for team in await claim_teams(client, claimed_team, 4)]
    await put_round_in_review(round_ids[1], ranked)
    await client.post(f"/admin/rounds/{round_ids[1]}/publish", headers=organiser)

    await patch_status(client, organiser, ranked[0], "disqualified")

    assert (await round_ranks(round_ids[1]))[ranked[0]] == 1
    nations = (await client.get("/standings")).json()["nations"]
    assert nations[0]["team_id"] == ranked[0]
    assert nations[0]["status"] == "disqualified"


async def test_a_team_disqualified_while_its_round_runs_lands_at_the_bottom(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    teams = await claim_teams(client, claimed_team, 3)
    best, second, third = (team.id for team in teams)
    await open_round(client, organiser, round_ids[1])
    for team in teams:
        await submit(client, team.headers, round_ids[1], TIT_FOR_TAT)

    async def engine_while_organiser_disqualifies(*args: object) -> engine_bridge.RoundRobinResult:
        # Stands in for the engine. The organiser disqualifies the team that is
        # about to come first while the matches are still playing.
        await patch_status(client, organiser, best, "disqualified")
        return engine_bridge.RoundRobinResult(
            matches=[match(best, second, 9, 1), match(best, third, 9, 2), match(second, third, 5, 3)],
            disqualified=[],
        )

    monkeypatch.setattr(engine_bridge, "run_round_robin", engine_while_organiser_disqualifies)
    await start_round(client, organiser, round_ids[1])

    rows = await run_sql(
        "SELECT team_id, score, rank FROM standings WHERE round_id = :id ORDER BY rank",
        id=round_ids[1],
    )
    assert [row.team_id for row in rows] == [second, third, best]
    # Moved, not wiped: its score stays, as a disqualification moves a team.
    assert rows[2].score == 18.0


async def test_two_disqualifications_at_once_both_count(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """Without the row locks, the second commit would undo the first one's move."""
    ranked = [team.id for team in await claim_teams(client, claimed_team, 5)]
    await put_round_in_review(round_ids[1], ranked)

    responses = await asyncio.gather(
        patch_status(client, organiser, ranked[0], "disqualified"),
        patch_status(client, organiser, ranked[1], "disqualified"),
    )

    assert [response.status_code for response in responses] == [200, 200]
    ranks = await round_ranks(round_ids[1])
    assert [ranks[team_id] for team_id in ranked[2:]] == [1, 2, 3]
    assert {ranks[ranked[0]], ranks[ranked[1]]} == {4, 5}
