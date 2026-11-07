"""Business rules for GET /standings, the war map feed (docs/api.md section 6).

Results stay private until a round is published. While a round is running or in
review, the map keeps showing the last published results, and organisers see the
new scores through /admin/overview instead. The privacy rule lives in the query
(standings_repository.list_latest_published), so no code path here can leak an
unpublished score.
"""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.repositories import rounds as rounds_repository
from app.repositories import standings as standings_repository
from app.schemas.standings import NationStanding, StandingsResponse


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
