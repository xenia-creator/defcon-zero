"""Database queries for wiping the event's data, used by scripts/reset_event.py.

All queries live in repositories. These are bulk statements that touch every row
of a table, so they are kept here, apart from the per-row queries the API uses,
where nothing else can call them by accident.

None of them commit. app/services/event_reset.py runs them all in one transaction,
so a failed reset leaves the database as it was.
"""

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.round import Round
from app.models.standing import Standing
from app.models.submission import Submission
from app.models.team import Team
from app.models.user import User


async def unlink_users_from_teams(db: AsyncSession) -> None:
    """Clear every account's team_id, so each team account is unclaimed again.

    users.team_id is a foreign key to teams, so Postgres would refuse to delete a
    team that an account still points at. Clearing it first is what lets
    delete_all_teams run, and the account itself, with its password, is kept.
    """
    await db.execute(update(User).values(team_id=None))


async def delete_all(db: AsyncSession, model: type) -> int:
    """Delete every row of one table. Returns how many rows were deleted.

    The caller deletes tables that point at teams and rounds (matches, standings,
    submissions) before teams, for the same foreign key reason as above.
    """
    result = await db.execute(delete(model))
    return result.rowcount


async def delete_team_accounts(db: AsyncSession) -> int:
    """Delete every account with role team. Organiser accounts are kept.

    Used when the dry run had test accounts, so the real ones can be loaded fresh
    with create_users.py. Returns how many accounts were deleted.
    """
    result = await db.execute(delete(User).where(User.role == "team"))
    return result.rowcount


async def delete_all_matches(db: AsyncSession) -> int:
    return await delete_all(db, Match)


async def delete_all_standings(db: AsyncSession) -> int:
    return await delete_all(db, Standing)


async def delete_all_submissions(db: AsyncSession) -> int:
    return await delete_all(db, Submission)


async def delete_all_teams(db: AsyncSession) -> int:
    return await delete_all(db, Team)


async def reset_all_rounds(db: AsyncSession) -> int:
    """Put every round back to waiting, as scripts/create_rounds.py made it.

    The times are cleared because a waiting round has none (docs/api.md section 4),
    and the seed because a new one is drawn when the round is next run. number,
    game and config are left alone, so the rounds stay the same three rounds.
    Returns how many rounds were reset.
    """
    result = await db.execute(
        update(Round).values(status="waiting", opens_at=None, closes_at=None, seed=None)
    )
    return result.rowcount
