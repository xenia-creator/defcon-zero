"""Database queries for the teams table. All queries live in repositories."""

from sqlalchemy import select, update
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


async def get_team_for_update(db: AsyncSession, team_id: int) -> Team | None:
    """Return a team and lock its row until the transaction ends, or None."""
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_team_by_id(db: AsyncSession, team_id: int) -> Team | None:
    """Return the team with this id, or None if there is no such team."""
    result = await db.execute(select(Team).where(Team.id == team_id))
    return result.scalar_one_or_none()


async def set_status_for_teams(db: AsyncSession, team_ids: list[int], status: str) -> None:
    """Give every team in the list this status, in one UPDATE, without committing."""
    if not team_ids:
        return
    await db.execute(update(Team).where(Team.id.in_(team_ids)).values(status=status))


async def list_active_team_ids(db: AsyncSession) -> list[int]:
    """Return the ids of every active team, in id order.

    A team row only exists once a territory is claimed, so every team here has one.
    """
    result = await db.execute(
        select(Team.id).where(Team.status == "active").order_by(Team.id)
    )
    return list(result.scalars())
