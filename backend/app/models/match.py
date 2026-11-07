"""The matches table: one game between two teams in a round.

docs/api.md exposes no match route, so these columns follow the engine instead:
schedule() in engine/tournament.py identifies a match by its repetition and two
bots, and each match produces one score per side.

Matches involving built-in bots are not stored: both sides must be real teams.
Every match the engine plays is stored, forfeits included, so organisers can see
what happened. `counted` says which of them make up the totals.
"""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        # Stops a retried round from storing the same match twice. There is no
        # check that the two teams differ. Rounds run without self-play, but
        # that is the caller's choice to the engine, not a rule of this table.
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
    # Floats for the same reason as standings.score: Theatre of War has half points.
    score_a: Mapped[float]
    score_b: Mapped[float]
    # The engine's own verdict. False for a forfeit, and for every match of a bot
    # the engine disqualified, so all remaining teams are scored on the same
    # opponents. Stored rather than worked out later from team status, because
    # an organiser can change a team's status after the round.
    counted: Mapped[bool]
