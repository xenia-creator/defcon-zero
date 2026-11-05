"""Every model, imported in one place.

A table only joins Base.metadata when its module is imported. Alembic imports
this package, so a model missing from this list would look deleted to autogenerate.
"""

from app.models.base import Base
from app.models.match import Match
from app.models.round import Round
from app.models.standing import Standing
from app.models.submission import Submission
from app.models.team import Team
from app.models.user import User

__all__ = ["Base", "Match", "Round", "Standing", "Submission", "Team", "User"]
