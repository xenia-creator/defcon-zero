"""The rounds table: one stage of the event (docs/api.md section 4).

server_time is not stored: it is the current time, added to each response.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, allowed_values
from app.schemas.rounds import Game, RoundStatus


class Round(Base):
    __tablename__ = "rounds"
    __table_args__ = (
        # `number` is the DEFCON level on display, so two rounds cannot share it.
        UniqueConstraint("number", name="uq_rounds_number"),
        allowed_values("game", Game),
        allowed_values("status", RoundStatus),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int]
    game: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="waiting")
    # timezone=True stores an absolute moment. Without it Postgres keeps a
    # wall-clock time with no zone, and the contract needs UTC timestamps.
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # JSONB because the app always reads config as a whole and its keys belong
    # to the API schema, so separate columns would only add migrations.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
