"""Database queries for the standings table. All queries live in repositories."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import Row, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.round import Round
from app.models.standing import Standing
from app.models.team import Team


async def add_standings(db: AsyncSession, round_id: int, rows: list[dict[str, Any]]) -> None:
    """Insert a round's standings in one statement, without committing.

    Each row holds team_id, score and rank. Skipped when empty, as an INSERT with
    no rows is an error.
    """
    if not rows:
        return
    await db.execute(insert(Standing), [{"round_id": round_id, **row} for row in rows])


async def list_latest_published(db: AsyncSession) -> Sequence[Row]:
    """Return each nation's result from the latest published round it played.

    DISTINCT ON (team_id) keeps the first row per team in the ORDER BY, which is
    its highest-numbered published round. A team knocked out in round 1 has no
    row in round 2, so it keeps its round 1 result. A team with no published
    result is absent. Unpublished rounds are filtered out here, which is what
    keeps results private until an organiser publishes them.

    The team's name, territory and status come from teams, so a status change,
    such as a disqualification, shows on the map at once.
    """
    latest = (
        select(
            Standing.team_id,
            Standing.score,
            Standing.rank,
            Round.number.label("round_number"),
        )
        .join(Round, Round.id == Standing.round_id)
        .where(Round.status == "published")
        .distinct(Standing.team_id)
        .order_by(Standing.team_id, Round.number.desc())
        .subquery()
    )
    result = await db.execute(
        select(
            Team.id.label("team_id"),
            Team.nation_name,
            Team.territory_code,
            Team.status,
            latest.c.score,
            latest.c.rank,
        )
        .join(latest, latest.c.team_id == Team.id)
        # Best first. Ranks from different rounds do not clash after the cut, as
        # the teams knocked out in round 1 hold the places below every team that
        # went on. The later round goes first if two ranks ever do clash, for
        # example after an organiser lets a knocked-out team back in.
        .order_by(latest.c.rank, latest.c.round_number.desc(), Team.id)
    )
    return result.all()
