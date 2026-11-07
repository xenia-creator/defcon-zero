"""Database queries for the submissions table. All queries live in repositories."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import Row, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.submission import Submission
from app.models.team import Team


async def get_by_id(db: AsyncSession, submission_id: int) -> Submission | None:
    """Return the submission with this id, or None if there is no such row."""
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    return result.scalar_one_or_none()


async def list_for_team(
    db: AsyncSession, team_id: int, round_id: int
) -> Sequence[Row]:
    """Return one team's submissions in a round, newest first.

    Only the summary columns are selected. A full row carries the code and the
    blocks, which can be hundreds of KB per version and which this list leaves out.
    """
    result = await db.execute(
        select(
            Submission.id,
            Submission.version,
            Submission.status,
            Submission.created_at,
        )
        .where(Submission.team_id == team_id, Submission.round_id == round_id)
        .order_by(Submission.version.desc())
    )
    return result.all()


async def list_unfinished_ids(db: AsyncSession) -> list[int]:
    """Return the ids of submissions still pending or running, oldest first."""
    result = await db.execute(
        select(Submission.id)
        .where(Submission.status.in_(("pending", "running")))
        .order_by(Submission.id)
    )
    return list(result.scalars())


async def get_by_idempotency_key(
    db: AsyncSession, team_id: int, idempotency_key: str
) -> Submission | None:
    """Return this team's submission with this key, or None.

    team_id is part of the search because keys belong to one team. Another team
    sending the same key must never be handed this team's code.
    """
    result = await db.execute(
        select(Submission).where(
            Submission.team_id == team_id,
            Submission.idempotency_key == idempotency_key,
        )
    )
    return result.scalar_one_or_none()


async def get_highest_version(db: AsyncSession, team_id: int) -> int:
    """Return the team's highest version number, or 0 before its first submit.

    The search covers all rounds, because version numbers keep counting across
    rounds rather than restarting at 1.
    """
    result = await db.execute(
        select(func.max(Submission.version)).where(Submission.team_id == team_id)
    )
    return result.scalar_one() or 0


async def create_submission(
    db: AsyncSession,
    team_id: int,
    round_id: int,
    version: int,
    code: str,
    blocks: dict[str, Any],
    idempotency_key: str | None,
) -> Submission:
    """Insert a submission and return it. The column default makes it pending."""
    submission = Submission(
        team_id=team_id,
        round_id=round_id,
        version=version,
        code=code,
        blocks=blocks,
        idempotency_key=idempotency_key,
    )
    db.add(submission)
    await db.flush()
    return submission


async def has_unfinished_in_round(db: AsyncSession, round_id: int) -> bool:
    """Return True if any submission in this round is still pending or running."""
    result = await db.execute(
        select(
            exists().where(
                Submission.round_id == round_id,
                Submission.status.in_(("pending", "running")),
            )
        )
    )
    return result.scalar_one()


async def get_playing_codes(
    db: AsyncSession, round_id: int, closes_at: datetime
) -> dict[int, str]:
    """Return the bot that plays for each active team, as team id to code.

    The contract's rule: the latest accepted submission created before closes_at.
    DISTINCT ON (team_id) is a Postgres feature that keeps the first row of each
    team in the ORDER BY, which here is the highest version. That picks one
    submission per team in a single query, instead of one query per team.

    Only active teams play, so an eliminated or disqualified team's last bot from
    this round is left out. A team with no accepted submission is simply absent.
    """
    result = await db.execute(
        select(Submission.team_id, Submission.code)
        .join(Team, Team.id == Submission.team_id)
        .where(
            Submission.round_id == round_id,
            Submission.status == "accepted",
            Submission.created_at < closes_at,
            Team.status == "active",
        )
        .distinct(Submission.team_id)
        .order_by(Submission.team_id, Submission.version.desc())
    )
    return {row.team_id: row.code for row in result}
