"""Database queries for the teams table. All queries live in repositories."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Team


async def create_team(db: AsyncSession, territory_code: str, nation_name: str) -> Team:
    """Insert a team and return it, with its new id filled in.

    flush sends the INSERT now but does not commit, so the service can still
    undo it. It raises IntegrityError here if a unique constraint refuses the row.
    """
    team = Team(territory_code=territory_code, nation_name=nation_name)
    db.add(team)
    await db.flush()
    return team


async def list_claimed_teams(db: AsyncSession) -> list[Team]:
    """Return every team that holds a territory."""
    result = await db.execute(select(Team).where(Team.territory_code.is_not(None)))
    return list(result.scalars())


async def get_team_by_id(db: AsyncSession, team_id: int) -> Team | None:
    """Return the team with this id, or None if there is no such team."""
    result = await db.execute(select(Team).where(Team.id == team_id))
    return result.scalar_one_or_none()
