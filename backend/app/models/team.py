"""The teams table: a nation in the game (docs/api.md sections 2, 3 and 7).

Login details live in users. This table holds what the war map shows.
"""

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, allowed_values
from app.schemas.teams import TeamStatus


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        # A unique constraint makes the database refuse a duplicate. Checking in
        # Python first is not enough: two teams claiming at the same moment could
        # both see the territory as free. The database decides one winner, and
        # the loser gets an error the service can turn into TERRITORY_TAKEN.
        # Postgres treats NULLs as different from each other, so any number of
        # teams can be unclaimed at once.
        UniqueConstraint("territory_code", name="uq_teams_territory_code"),
        # A UNIQUE constraint only accepts plain columns, not lower(...), so
        # ignoring case needs a unique index on the expression. It refuses
        # duplicates the same way and reports this name the same way, so
        # "Red Dawn" and "RED DAWN" cannot both exist.
        Index("uq_teams_nation_name_lower", text("lower(nation_name)"), unique=True),
        allowed_values("status", TeamStatus),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # `str | None` makes the column nullable, and plain `str` makes it NOT NULL.
    # Both of these stay null until the team claims a territory.
    territory_code: Mapped[str | None]
    nation_name: Mapped[str | None]
    status: Mapped[str] = mapped_column(server_default="active")
