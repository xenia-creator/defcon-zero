"""The users table: login accounts for teams and organisers (docs/api.md section 2)."""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, allowed_values
from app.schemas.auth import Role


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Login finds an account by username, so a username must match only one.
        UniqueConstraint("username", name="uq_users_username"),
        # One login per team: PATCH /admin/teams/{id} returns a GET /me body, which
        # needs a single username per team. NULLs count as different, so any number
        # of organisers can have no team.
        UniqueConstraint("team_id", name="uq_users_team_id"),
        allowed_values("role", Role),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str]
    # Only the Argon2 hash is stored. A leaked table must not reveal passwords.
    password_hash: Mapped[str]
    role: Mapped[str]
    # Null for organisers, who do not belong to a team. This is a real foreign
    # key, so the database rejects a team that does not exist. The models have
    # no relationship() attributes: repositories write explicit joins, so every
    # query is visible in the code and none fire implicitly.
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
