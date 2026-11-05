"""The matches table: one game between two teams in a round.

docs/api.md exposes no match route, so these columns follow the engine instead:
schedule() in engine/tournament.py identifies a match by its repetition and two
bots, and each match produces one score per side.

Matches involving built-in bots are not stored: both sides must be real teams.
"""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        # Stops a retried round from storing the same match twice. There is no
        # check that the two teams differ: the engine has every bot play itself.
        UniqueConstraint(
            "round_id",
            "team_a_id",
            "team_b_id",
            "repetition",
            name="uq_matches_round_team_a_team_b_repetition",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id"))
    team_a_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    team_b_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    # Counts from 0, as the engine does.
    repetition: Mapped[int]
    score_a: Mapped[int]
    score_b: Mapped[int]
