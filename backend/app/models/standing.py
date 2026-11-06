"""The standings table: a team's result in a round (docs/api.md section 6).

Only score and rank are stored. The other fields in GET /standings already live
in teams and rounds, and a second copy could fall out of step. A disqualification
must show on the map straight away, for example.
"""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Standing(Base):
    __tablename__ = "standings"
    __table_args__ = (
        # One row per team per round, so a re-run cannot list a nation twice.
        UniqueConstraint("round_id", "team_id", name="uq_standings_round_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id"))
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    score: Mapped[int]
    rank: Mapped[int]
