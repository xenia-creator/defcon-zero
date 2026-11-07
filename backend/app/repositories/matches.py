"""Database queries for the matches table. All queries live in repositories."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import Row, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match


async def add_matches(db: AsyncSession, round_id: int, rows: list[dict[str, Any]]) -> None:
    """Insert a round's matches in one statement, without committing.

    Each row holds the Match columns except round_id, which is the same for all.
    Plain dictionaries rather than the engine bridge's type, so this layer does
    not depend on the services layer above it.

    One INSERT with many rows, rather than db.add per match, because a round of
    30 teams has over 2000 matches and one round trip per row would be slow.
    An empty list is skipped, as an INSERT with no rows is an error.
    """
    if not rows:
        return
    await db.execute(insert(Match), [{"round_id": round_id, **row} for row in rows])


async def list_for_round(db: AsyncSession, round_id: int) -> Sequence[Row]:
    """Return a round's matches, with the columns a re-rank needs."""
    result = await db.execute(
        select(
            Match.team_a_id,
            Match.team_b_id,
            Match.repetition,
            Match.score_a,
            Match.score_b,
            Match.counted,
        ).where(Match.round_id == round_id)
    )
    return result.all()
