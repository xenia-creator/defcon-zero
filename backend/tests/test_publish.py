"""Tests for POST /admin/rounds/{id}/publish: the publish rules and the cut.

Round 1 keeps its top 15, round 2 its top 8 and round 3 its top 2 (docs/api.md
section 4). The standings are written straight to the database, as a run would
leave them, so these tests need no engine.

Auth for this route is covered with the other admin routes in test_rounds.py.
"""

import httpx
import pytest

from tests.conftest import assert_error, run_sql
from tests.tournament_helpers import (
    ClaimedTeam,
    claim_teams,
    put_round_in_review,
    round_status,
    team_statuses,
)


async def publish(
    client: httpx.AsyncClient, organiser: dict[str, str], round_id: int
) -> httpx.Response:
    return await client.post(f"/admin/rounds/{round_id}/publish", headers=organiser)


async def reach_review(round_ids: dict[int, int], number: int, ranked: list[int]) -> None:
    """Publish every earlier round, as the order rule needs, and put this one in review."""
    await run_sql("UPDATE rounds SET status = 'published' WHERE number < :n", n=number)
    await put_round_in_review(round_ids[number], ranked)


# --- Publish rules ---


async def test_publish_moves_review_to_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 2)]
    await reach_review(round_ids, 1, ranked)

    response = await publish(client, organiser, round_ids[1])

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == round_ids[1]
    assert body["status"] == "published"
    assert "server_time" in body and "seed" not in body
    assert await round_status(round_ids[1]) == "published"


@pytest.mark.parametrize("status", ["waiting", "open", "running", "published"])
async def test_publish_only_works_from_review(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    status: str,
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 2)]
    await put_round_in_review(round_ids[1], ranked)
    await run_sql("UPDATE rounds SET status = :s WHERE id = :id", s=status, id=round_ids[1])

    response = await publish(client, organiser, round_ids[1])

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")
    # Refused means nothing happened, the cut included.
    assert await round_status(round_ids[1]) == status
    assert set((await team_statuses()).values()) == {"active"}


async def test_publishing_twice_is_409_and_cuts_once(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 3)]
    await reach_review(round_ids, 3, ranked)
    assert (await publish(client, organiser, round_ids[3])).status_code == 200
    # An organiser restores the knocked-out team after the publish.
    await run_sql("UPDATE teams SET status = 'active' WHERE id = :id", id=ranked[2])

    assert_error(await publish(client, organiser, round_ids[3]), 409, "INVALID_ROUND_TRANSITION")
    assert (await team_statuses())[ranked[2]] == "active"


async def test_the_next_round_opens_only_after_publish(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 2)]
    await reach_review(round_ids, 1, ranked)
    open_2 = {"json": {"minutes": 30}, "headers": organiser}

    before = await client.post(f"/admin/rounds/{round_ids[2]}/open", **open_2)
    await publish(client, organiser, round_ids[1])
    after = await client.post(f"/admin/rounds/{round_ids[2]}/open", **open_2)

    assert_error(before, 409, "INVALID_ROUND_TRANSITION")
    assert after.status_code == 200


# --- The cut ---


@pytest.mark.parametrize("number,kept", [(1, 15), (2, 8), (3, 2)])
async def test_the_cut_keeps_the_top_teams_of_each_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    number: int,
    kept: int,
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 20)]
    await reach_review(round_ids, number, ranked)

    await publish(client, organiser, round_ids[number])

    statuses = await team_statuses()
    assert [statuses[team_id] for team_id in ranked[:kept]] == ["active"] * kept
    assert [statuses[team_id] for team_id in ranked[kept:]] == ["eliminated"] * (20 - kept)


async def test_the_cut_leaves_disqualified_teams_disqualified(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 4)]
    await reach_review(round_ids, 3, ranked)
    await run_sql("UPDATE teams SET status = 'disqualified' WHERE id = :id", id=ranked[3])

    await publish(client, organiser, round_ids[3])

    statuses = await team_statuses()
    assert statuses[ranked[3]] == "disqualified"
    assert statuses[ranked[2]] == "eliminated"


async def test_the_cut_eliminates_active_teams_that_did_not_play(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """A team that claimed after the round started has no rank, so it is not in the top."""
    *ranked, late = [team.id for team in await claim_teams(client, claimed_team, 3)]
    await reach_review(round_ids, 1, ranked)

    await publish(client, organiser, round_ids[1])

    statuses = await team_statuses()
    assert statuses[late] == "eliminated"
    assert [statuses[team_id] for team_id in ranked] == ["active", "active"]


async def test_the_cut_only_uses_the_published_rounds_ranks(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    """Round 1's ranks must not keep a team in at round 3's cut."""
    ranked = [team.id for team in await claim_teams(client, claimed_team, 3)]
    await put_round_in_review(round_ids[1], ranked)
    await run_sql("UPDATE rounds SET status = 'published' WHERE number < 3")
    # The round 1 rank 1 team finishes last in round 3.
    await put_round_in_review(round_ids[3], [ranked[1], ranked[2], ranked[0]])

    await publish(client, organiser, round_ids[3])

    statuses = await team_statuses()
    assert statuses[ranked[0]] == "eliminated"
    assert statuses[ranked[1]] == statuses[ranked[2]] == "active"


async def test_publishing_round_3_leaves_the_winner_and_runner_up(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    ranked = [team.id for team in await claim_teams(client, claimed_team, 8)]
    await reach_review(round_ids, 3, ranked)

    await publish(client, organiser, round_ids[3])

    nations = (await client.get("/standings")).json()["nations"]
    winner, runner_up = nations[0], nations[1]
    assert (winner["team_id"], winner["rank"], winner["status"]) == (ranked[0], 1, "active")
    assert (runner_up["team_id"], runner_up["rank"], runner_up["status"]) == (ranked[1], 2, "active")
    assert all(n["status"] == "eliminated" for n in nations[2:])
