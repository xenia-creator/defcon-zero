"""Business rules for standings: GET /standings, the war map feed (docs/api.md
section 6), and re-ranking a round in review when a team is disqualified or
restored.

Results stay private until a round is published. While a round is running or in
review, the map keeps showing the last published results, and organisers see the
new scores through /admin/overview instead. The privacy rule lives in the query
(standings_repository.list_latest_published), so no code path here can leak an
unpublished score.
"""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.repositories import matches as matches_repository
from app.repositories import rounds as rounds_repository
from app.repositories import standings as standings_repository
from app.repositories import teams as teams_repository
from app.schemas.standings import NationStanding, StandingsResponse
from app.services import engine_bridge, ranking


async def get_standings(db: AsyncSession) -> StandingsResponse:
    """Return the GET /standings body, or 404 NOT_FOUND before any round starts.

    round_id and round_status are the current round's, the same round as
    GET /rounds/current, so the map can show that a round is running. The nations
    are each team's latest published result, which can be from an earlier round.
    A nation with no published result yet is left out, so the list is empty
    until the first round is published.
    """
    current = await rounds_repository.get_latest_started_round(db)
    if current is None:
        raise AppError("NOT_FOUND", "No round has started yet.", 404)
    rows = await standings_repository.list_latest_published(db)
    return StandingsResponse(
        round_id=current.id,
        round_status=current.status,
        nations=[
            NationStanding(
                team_id=row.team_id,
                nation_name=row.nation_name,
                territory_code=row.territory_code,
                status=row.status,
                score=row.score,
                rank=row.rank,
            )
            for row in rows
        ],
        server_time=datetime.now(UTC),
    )


async def drop_to_bottom(db: AsyncSession, round_id: int, team_id: int) -> None:
    """Move disqualified teams to the bottom of the standings.

    The rows themselves are locked here, so two re-ranks run one at a time.
    """
    rows = await standings_repository.list_for_round_for_update(db, round_id)

    if all(row.team_id != team_id for row in rows):
        return

    current = [
        ranking.TeamResult(row.team_id, row.score, row.rank)
        for row in rows
    ]

    disqualified_ids = await teams_repository.list_disqualified_ids(
        db, [row.team_id for row in rows]
    )

    new_rank = {
        r.team_id: r.rank
        for r in ranking.move_to_bottom(current, disqualified_ids)
    }

    # Changing the loaded rows is enough: the session writes the changed ranks
    # back as UPDATEs when the caller commits.
    for row in rows:
        row.rank = new_rank[row.team_id]


async def rerank_round(db: AsyncSession, round_id: int, seed: int) -> None:
    """Rank a round again from its stored matches, by the run's own rules. No commit.

    For a disqualified team set back to active, so it returns to the place it
    earned. ranking.rank_round is the same function the run used, so with the
    same counted matches and the same seed it gives the same score groups and
    the same break_tie order inside each. Every team disqualified now goes to
    the bottom, so a restored team's place is given back and no other team's
    changes, except that the bottom group may come out in a different order.

    What the run knew is rebuilt from the database:
    - entrants: every team with a standings row in this round.
    - players: every team with a match in this round. A team with no accepted
      submission played none, so it lands in the no-submission group again.
    - disqualified: every entrant whose status is disqualified now.

    Same locking as drop_to_bottom: the rows are locked here, and the caller holds
    the round so it cannot be published meanwhile.
    """
    rows = await standings_repository.list_for_round_for_update(db, round_id)
    entrant_ids = [row.team_id for row in rows]
    matches = [
        engine_bridge.MatchRecord(**match._asdict())
        for match in await matches_repository.list_for_round(db, round_id)
    ]
    player_ids = sorted({m.team_a_id for m in matches} | {m.team_b_id for m in matches})
    result = engine_bridge.RoundRobinResult(
        matches=matches,
        disqualified=await teams_repository.list_disqualified_ids(db, entrant_ids),
    )
    new_rank = {
        r.team_id: r.rank
        for r in ranking.rank_round(entrant_ids, player_ids, result, seed)
    }
    for row in rows:
        row.rank = new_rank[row.team_id]
