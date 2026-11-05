"""The submissions table: every version of every bot (docs/api.md section 5).

Rows are only ever added, never overwritten. The only later change to a row is
the background check writing `status` and `check`.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, allowed_values
from app.schemas.submissions import SubmissionStatus


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        # Two simultaneous submits could both compute the same next version.
        # This makes the second one fail instead of creating a duplicate.
        # team_id is the scope, not round_id, so a team's version numbers keep
        # counting up across rounds rather than restarting at 1.
        UniqueConstraint("team_id", "version", name="uq_submissions_team_version"),
        # The key is scoped to the team so two teams can never collide. NULLs
        # count as different, so any number of submits may omit the header.
        UniqueConstraint(
            "team_id", "idempotency_key", name="uq_submissions_team_idempotency_key"
        ),
        allowed_values("status", SubmissionStatus),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Not in the JSON body, but needed to enforce "own team only" on reads.
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id"))
    version: Mapped[int]
    status: Mapped[str] = mapped_column(server_default="pending")
    # The database sets this, so one clock decides "created before closes_at"
    # and a client cannot influence it.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    code: Mapped[str] = mapped_column(Text)
    blocks: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # none_as_null=True saves Python None as SQL NULL. The default saves the JSON
    # value `null`, and then "check IS NULL" would miss pending submissions.
    check: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    # Never returned by the API. A repeated key is compared against this row's
    # round_id, code and blocks to decide between 200 and 422, so no separate
    # hash of the request body has to be stored.
    idempotency_key: Mapped[str | None]
