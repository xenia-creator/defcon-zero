"""Turns a round's match results into each team's score and rank.

Run once, when a round's matches finish, and stored in the standings table with
them. GET /standings and /admin/overview then only read rows, which matters as
the war map polls every 2 seconds.

A pure function with no database access, so the ranking rules can be tested on
their own.
"""

from itertools import groupby
from typing import NamedTuple

from app.services import engine_bridge


class TeamResult(NamedTuple):
    team_id: int
    score: float
    rank: int


def total_scores(
    team_ids: list[int], matches: list[engine_bridge.MatchRecord]
) -> dict[int, float]:
    """Add up each team's score over the matches that count.

    Uncounted matches are left out: forfeits, and every match of a disqualified
    bot, so every remaining team is scored against the same opponents. A team
    with no counted matches scores 0.
    """
    totals = {team_id: 0.0 for team_id in team_ids}
    for match in matches:
        if match.counted:
            totals[match.team_a_id] += match.score_a
            totals[match.team_b_id] += match.score_b
    return totals


def order_by_score(
    team_ids: list[int],
    totals: dict[int, float],
    matches: list[engine_bridge.MatchRecord],
    seed: int,
) -> list[int]:
    """Highest score first. Each group on the same score is ordered by break_tie.

    groupby only groups neighbours, which is why the list is sorted by score first.
    The tie-break sees only counted matches, so a forfeit cannot win head to head.
    """
    counted = [match for match in matches if match.counted]
    by_score = sorted(team_ids, key=lambda team_id: totals[team_id], reverse=True)
    ordered = []
    for _, group in groupby(by_score, key=lambda team_id: totals[team_id]):
        ordered.extend(engine_bridge.order_tied_teams(list(group), counted, seed))
    return ordered


def rank_round(
    entrant_ids: list[int],
    player_ids: list[int],
    result: engine_bridge.RoundRobinResult,
    seed: int,
) -> list[TeamResult]:
    """Rank every team that entered the round, best first.

    entrant_ids is every team active when the round ran. player_ids is the ones
    that had an accepted bot. The order has three parts:

    1. Teams that played and were not disqualified, by score.
    2. Teams with no accepted submission. They played nothing, so all score 0,
       and break_tie orders them by seed alone.
    3. Teams the engine disqualified. Below the teams that never played, since
       their bots broke the rules. Also 0, also ordered by seed.

    Ranks are positions, 1 to N with no equal ranks. The engine's README says
    advancement must follow break_tie's order rather than equal ranks, and the
    cut needs exactly one team in each place.
    """
    disqualified = set(result.disqualified)
    players = set(player_ids)
    scored = [team_id for team_id in entrant_ids if team_id in players and team_id not in disqualified]
    no_submission = [team_id for team_id in entrant_ids if team_id not in players]
    broke_rules = [team_id for team_id in entrant_ids if team_id in disqualified]

    totals = total_scores(entrant_ids, result.matches)
    order = (
        order_by_score(scored, totals, result.matches, seed)
        + engine_bridge.order_tied_teams(no_submission, [], seed)
        + engine_bridge.order_tied_teams(broke_rules, [], seed)
    )
    return [
        TeamResult(team_id=team_id, score=totals[team_id], rank=position)
        for position, team_id in enumerate(order, start=1)
    ]
