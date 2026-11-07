"""The whole event, from opening round 1 to a winner, through the API alone.

Real matches, real submission checks and a real seed, so the exact order changes
from run to run. The test checks what must always hold: who plays each round,
the cut, who is disqualified, and that the final standings end with one winner
and one runner-up above everyone else.

Slower than the other tests, under a minute, as it plays over 1300 matches.
"""

import httpx

from tests.conftest import assert_error
from tests.tournament_helpers import (
    ALWAYS_BETRAY,
    ALWAYS_COOPERATE,
    RANDOM_MOVE,
    TIME_BOMB,
    TIT_FOR_TAT,
    ClaimedTeam,
    TeamLogin,
    claim_teams,
    foreign_aid_bot,
    open_round,
    round_ranks,
    round_status,
    start_round,
    stored_matches,
    submit,
    team_statuses,
    theatre_of_war_bot,
)

PRISONERS_DILEMMA_BOTS = [TIT_FOR_TAT, ALWAYS_BETRAY, ALWAYS_COOPERATE, RANDOM_MOVE]
REPETITIONS = 5


def pairs(count: int) -> int:
    return count * (count - 1) // 2


async def active_teams(teams: list[TeamLogin]) -> list[TeamLogin]:
    statuses = await team_statuses()
    return [team for team in teams if statuses[team.id] == "active"]


async def play_and_publish(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_id: int,
    expected_players: int,
) -> dict[int, int]:
    """Start a round, check it reached review with every match, publish it. Returns ranks."""
    await start_round(client, organiser, round_id)
    assert await round_status(round_id) == "review"
    assert len(await stored_matches(round_id)) == pairs(expected_players) * REPETITIONS
    ranks = await round_ranks(round_id)
    published = await client.post(f"/admin/rounds/{round_id}/publish", headers=organiser)
    assert published.status_code == 200
    return ranks


async def test_three_rounds_from_open_to_winner(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    teams = await claim_teams(client, claimed_team, 18)
    players, absent, bomb = teams[:16], teams[16], teams[17]

    # --- Round 1: Prisoner's Dilemma. 16 bots, one team with none, one bad bot.
    await open_round(client, organiser, round_ids[1])
    for index, team in enumerate(players):
        await submit(client, team.headers, round_ids[1], PRISONERS_DILEMMA_BOTS[index % 4])
    await submit(client, bomb.headers, round_ids[1], TIME_BOMB)

    # 17 bots play: the 16 players and the bomb, which forfeits.
    ranks_1 = await play_and_publish(client, organiser, round_ids[1], expected_players=17)

    statuses = await team_statuses()
    assert statuses[bomb.id] == "disqualified"
    assert ranks_1[bomb.id] == 18
    assert ranks_1[absent.id] == 17
    assert statuses[absent.id] == "eliminated"
    # The cut keeps the top 15, all of them players. The 16th player goes out.
    round_2_teams = await active_teams(teams)
    assert len(round_2_teams) == 15
    assert {ranks_1[team.id] for team in round_2_teams} == set(range(1, 16))
    sixteenth = next(team for team in players if ranks_1[team.id] == 16)
    assert statuses[sixteenth.id] == "eliminated"

    # --- Round 2: Theatre of War, for the 15 still in.
    await open_round(client, organiser, round_ids[2])
    for index, team in enumerate(round_2_teams):
        await submit(client, team.headers, round_ids[2], theatre_of_war_bot(index))
    # A team that went out in round 1 cannot submit any more.
    refused = await client.post(
        "/submissions",
        json={"round_id": round_ids[2], "code": theatre_of_war_bot(0), "blocks": {"modules": []}},
        headers=sixteenth.headers,
    )
    assert_error(refused, 403, "FORBIDDEN")

    ranks_2 = await play_and_publish(client, organiser, round_ids[2], expected_players=15)

    assert sorted(ranks_2.values()) == list(range(1, 16))
    round_3_teams = await active_teams(teams)
    assert len(round_3_teams) == 8
    assert {ranks_2[team.id] for team in round_3_teams} == set(range(1, 9))

    # --- Round 3: Foreign Aid, for the final 8.
    await open_round(client, organiser, round_ids[3])
    for index, team in enumerate(round_3_teams):
        await submit(client, team.headers, round_ids[3], foreign_aid_bot(index + 1))

    ranks_3 = await play_and_publish(client, organiser, round_ids[3], expected_players=8)

    # --- The result: one winner and one runner-up, still active.
    finalists = await active_teams(teams)
    by_rank = sorted(ranks_3, key=ranks_3.get)
    winner, runner_up = by_rank[0], by_rank[1]
    assert {team.id for team in finalists} == {winner, runner_up}

    standings = (await client.get("/standings")).json()
    assert standings["round_id"] == round_ids[3]
    assert standings["round_status"] == "published"
    nations = standings["nations"]
    # Every nation that ever played is listed once, with its final place, 1 to 18.
    assert len(nations) == 18
    assert [n["rank"] for n in nations] == list(range(1, 19))
    assert [n["team_id"] for n in nations[:2]] == [winner, runner_up]
    assert [n["status"] for n in nations[:2]] == ["active", "active"]
    # Places 3 to 8 went out in round 3, 9 to 15 in round 2, 16 and 17 in
    # round 1, and the disqualified bot is last.
    assert [n["team_id"] for n in nations[2:8]] == by_rank[2:]
    assert all(n["status"] == "eliminated" for n in nations[2:17])
    assert [n["team_id"] for n in nations[8:15]] == sorted(
        (team_id for team_id in ranks_2 if ranks_2[team_id] > 8), key=ranks_2.get
    )
    assert [n["team_id"] for n in nations[15:]] == [sixteenth.id, absent.id, bomb.id]
    assert nations[17]["status"] == "disqualified"

    # The organiser console agrees on the round and the finalists.
    overview = (await client.get("/admin/overview", headers=organiser)).json()
    assert overview["round"]["number"] == 3
    assert overview["round"]["status"] == "published"
    active_in_console = {team["team_id"] for team in overview["teams"] if team["status"] == "active"}
    assert active_in_console == {winner, runner_up}
