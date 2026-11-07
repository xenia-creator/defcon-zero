"""make scores floats

Scores become floats, because Theatre of War gives half a point for a tied turn
and docs/api.md section 8 makes every score a float. This changes
standings.score, matches.score_a and matches.score_b from integer to float.

Revision ID: b7d2e4f1c9a0
Revises: 3a38033fd746
Create Date: 2026-11-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b7d2e4f1c9a0'
down_revision: Union[str, Sequence[str], None] = '3a38033fd746'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Each (table, column) whose type changes. One list, so upgrade and downgrade
# cannot drift apart.
SCORE_COLUMNS = [
    ("standings", "score"),
    ("matches", "score_a"),
    ("matches", "score_b"),
]


def upgrade() -> None:
    """Integer to float.

    sa.Float() is what SQLAlchemy uses for Mapped[float], and in Postgres it is
    double precision. Postgres turns integers into floats automatically, and every
    integer score fits exactly, so existing rows keep their values.
    """
    for table, column in SCORE_COLUMNS:
        op.alter_column(
            table, column,
            existing_type=sa.Integer(), type_=sa.Float(), existing_nullable=False,
        )


def downgrade() -> None:
    """Float back to integer.

    Postgres will not do this one automatically, so USING says how: round().
    This loses any half points, which is unavoidable when going back to integers.
    """
    for table, column in SCORE_COLUMNS:
        op.alter_column(
            table, column,
            existing_type=sa.Float(), type_=sa.Integer(), existing_nullable=False,
            postgresql_using=f"round({column})::integer",
        )
