"""Shared helpers for the tournament tests: bots, teams, and stored round results.

Not a test file itself (the name does not start with test_), so pytest only
collects it through the tests that import it.
"""

from collections.abc import Awaitable, Callable
from typing import NamedTuple

import httpx

from app.core.territories import TERRITORIES
from app.services import engine_bridge, ranking
from tests.conftest import run_sql

ClaimedTeam = Callable[..., Awaitable[dict[str, str]]]

BLOCKS = {"modules": [{"type": "workspace"}]}

# Prisoner's Dilemma bots.
TIT_FOR_TAT = (
    "def strategy(my_history, opp_history):\n"
    "    return opp_history[-1] if opp_history else 'C'\n"
)
ALWAYS_COOPERATE = "def strategy(my_history, opp_history):\n    return 'C'\n"
ALWAYS_BETRAY = "def strategy(my_history, opp_history):\n    return 'D'\n"
RANDOM_MOVE = (
    "import random\n\n"
    "def strategy(my_history, opp_history):\n"
    "    return random.choice(['C', 'D'])\n"
)
BAD_SYNTAX = "def strategy(my_history, opp_history)\n    return 'C'\n"
# Passes the submission check, which plays 50 turns, then raises in the real
# round, which always plays at least 150. So it is accepted and then forfeits.
TIME_BOMB = (
    "def strategy(my_history, opp_history):\n"
    "    if len(my_history) > 120:\n"
    "        raise ValueError('boom')\n"
    "    return 'C'\n"
)


def theatre_of_war_bot(k: int) -> str:
    """A Theatre of War bot that shifts k troops from region 2 to region 1."""
    return (
        "def strategy(my_history, opp_history):\n"
        f"    return [{20 + k}, {20 - k}, 20, 20, 20]\n"
    )


def foreign_aid_bot(k: int) -> str:
    """A Foreign Aid bot that sends k and returns k when receiving, within range."""
    return (
        "def strategy(my_history, opp_history):\n"
        "    if len(opp_history) == len(my_history):\n"
        f"        return {k % 11}\n"
        f"    return min({k}, 3 * opp_history[-1])\n"
    )


class TeamLogin(NamedTuple):
    id: int
    headers: dict[str, str]



async def claim_teams(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, count: int
) -> list[TeamLogin]:
    """Make this many claimed teams, named team_00, team_01 and so on, in order."""
    teams = []
    for index, code in enumerate(list(TERRITORIES)[:count]):
        name = "Nation " + chr(65 + index // 26) + chr(65 + index % 26)
        headers = await claimed_team(f"team_{index:02d}", code, name)
        me = await client.get("/me", headers=headers)
        teams.append(TeamLogin(me.json()["team_id"], headers))

    return teams



async def open_round(client: httpx.AsyncClient, organiser: dict[str, str], round_id: int) -> None:
    response = await client.post(
        f"/admin/rounds/{round_id}/open", json={"minutes": 30}, headers=organiser
    )
    assert response.status_code == 200, response.text


async def submit(
    client: httpx.AsyncClient, headers: dict[str, str], round_id: int, code: str
) -> None:
    """Submit a bot. The test client waits for the check, so it has finished on return."""
    response = await client.post(
        "/submissions",
        json={"round_id": round_id, "code": code, "blocks": BLOCKS},
        headers=headers,
    )
    assert response.status_code == 202, response.text


async def start_round(
    client: httpx.AsyncClient, organiser: dict[str, str], round_id: int
) -> httpx.Response:
    """Start a round. The test client also waits for the background run to finish."""
    response = await client.post(f"/admin/rounds/{round_id}/start", headers=organiser)
    assert response.status_code == 200, response.text
    return response


async def round_status(round_id: int) -> str:
    rows = await run_sql("SELECT status FROM rounds WHERE id = :id", id=round_id)
    return rows[0][0]


async def team_statuses() -> dict[int, str]:
    return dict(await run_sql("SELECT id, status FROM teams"))


async def round_ranks(round_id: int) -> dict[int, int]:
    return dict(await run_sql(
        "SELECT team_id, rank FROM standings WHERE round_id = :id", id=round_id
    ))


async def stored_matches(round_id: int) -> list:
    return await run_sql(
        "SELECT team_a_id, team_b_id, repetition, score_a, score_b, counted "
        "FROM matches WHERE round_id = :id ORDER BY team_a_id, team_b_id, repetition",
        id=round_id,
    )


async def put_round_in_review(round_id: int, ranked_team_ids: list[int]) -> None:
    """Store standings for a round in review, ranked in the order given.

    Written straight to the database, as a round run would leave them, so the
    test needs no engine run. Scores fall with rank, as real ones would.
    """
    await run_sql("UPDATE rounds SET status = 'review' WHERE id = :id", id=round_id)
    for rank, team_id in enumerate(ranked_team_ids, start=1):
        await run_sql(
            "INSERT INTO standings (round_id, team_id, score, rank) "
            "VALUES (:round_id, :team_id, :score, :rank)",
            round_id=round_id, team_id=team_id, score=1000.0 - rank, rank=rank,
        )


ROUND_SEED = 424242


def match(
    team_a: int, team_b: int, score_a: float, score_b: float, counted: bool = True, repetition: int = 0
) -> engine_bridge.MatchRecord:
    return engine_bridge.MatchRecord(
        team_a_id=team_a, team_b_id=team_b, repetition=repetition,
        score_a=score_a, score_b=score_b, counted=counted,
    )


async def store_round_results(
    round_id: int, player_ids: list[int], no_submission_ids: list[int]
) -> dict[int, int]:
    """Store matches and standings for a round in review, as a run would leave them.

    The first player beats everyone, the last loses to everyone, and every other
    match is a draw. So the players in between all tie on score with only drawn
    head to heads, and their order comes from break_tie's seeded draw alone.
    The standings come from ranking.rank_round, the function a run uses, with the
    round's seed. Returns each team's rank.
    """
    first, last = player_ids[0], player_ids[-1]
    matches = []
    for index, team_a in enumerate(player_ids):
        for team_b in player_ids[index + 1:]:
            if team_a == first or team_b == last:
                matches.append(match(team_a, team_b, 5.0, 0.0))
            else:
                matches.append(match(team_a, team_b, 3.0, 3.0))
    for record in matches:
        await run_sql(
            "INSERT INTO matches (round_id, team_a_id, team_b_id, repetition, score_a, score_b, counted) "
            "VALUES (:round_id, :team_a_id, :team_b_id, :repetition, :score_a, :score_b, :counted)",
            round_id=round_id, **record.model_dump(),
        )

    entrants = player_ids + no_submission_ids
    result = engine_bridge.RoundRobinResult(matches=matches, disqualified=[])
    standings = ranking.rank_round(entrants, player_ids, result, ROUND_SEED)
    for standing in standings:
        await run_sql(
            "INSERT INTO standings (round_id, team_id, score, rank) "
            "VALUES (:round_id, :team_id, :score, :rank)",
            round_id=round_id, **standing._asdict(),
        )
    await run_sql(
        "UPDATE rounds SET status = 'review', seed = :seed WHERE id = :id",
        seed=ROUND_SEED, id=round_id,
    )
    return {standing.team_id: standing.rank for standing in standings}
