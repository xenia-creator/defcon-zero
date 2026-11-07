"""Database queries for the teams table. All queries live in repositories."""

from collections.abc import Sequence

from sqlalchemy import Row, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.standing import Standing
from app.models.team import Team
from app.models.user import User


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


async def eliminate_outside_top(db: AsyncSession, round_id: int, keep: int) -> None:
    """Eliminate every active team not ranked 1 to keep in this round, without committing.

    One UPDATE with a subquery, so the whole cut is a single statement. Only
    active teams change: a disqualified team stays disqualified, as that is the
    stronger verdict. A team with no row in this round, such as one that claimed
    after it started, is not in the top either, so it goes out too.
    """
    kept = select(Standing.team_id).where(
        Standing.round_id == round_id, Standing.rank <= keep
    )
    await db.execute(
        update(Team)
        .where(Team.status == "active", Team.id.not_in(kept))
        .values(status="eliminated")
    )


async def list_disqualified_ids(db: AsyncSession, team_ids: list[int]) -> list[int]:
    """Return which of these teams are disqualified now."""
    if not team_ids:
        return []
    result = await db.execute(
        select(Team.id).where(Team.id.in_(team_ids), Team.status == "disqualified")
    )
    return list(result.scalars())


async def list_teams_with_usernames(db: AsyncSession) -> Sequence[Row]:
    """Return every team with its account's username, in username order.

    One join, rather than a query per team for its user. Username order gives
    the organiser console a stable list that does not jump around between polls.
    """
    result = await db.execute(
        select(
            Team.id.label("team_id"),
            User.username,
            Team.nation_name,
            Team.territory_code,
            Team.status,
        )
        .join(User, User.team_id == Team.id)
        .order_by(User.username)
    )
    return result.all()
