"""add round cut

rounds.cut: how many teams a round keeps when it is published. It used to be the
constant TEAMS_KEPT_BY_ROUND_NUMBER in app/core/rounds.py. It is stored per round
now so organisers can change it during the event (PATCH /admin/rounds/{id}).

Existing rows are filled from that constant, so a database migrated mid-event
cuts exactly as it would have before. The numbers are written out here rather
than imported: a migration must keep doing what it did when it was written,
even if the constant changes later.

Revision ID: d5f9b2e6a1c3
Revises: c4e8a1d3f5b2
Create Date: 2026-11-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd5f9b2e6a1c3'
down_revision: Union[str, Sequence[str], None] = 'c4e8a1d3f5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Added nullable first, because rows that already exist have no value yet.
    # Once every row is filled the column becomes NOT NULL, so the app can rely
    # on every round having a cut.
    op.add_column('rounds', sa.Column('cut', sa.Integer(), nullable=True))
    op.execute(
        "UPDATE rounds SET cut = CASE number "
        "WHEN 1 THEN 15 WHEN 2 THEN 8 WHEN 3 THEN 2 END"
    )
    op.alter_column('rounds', 'cut', nullable=False)
    # A cut of 0 or less would eliminate every team. The API refuses it first,
    # with a clear message; this is the last line of defence.
    # op.f marks the name as final, as in the first migration, so the naming
    # convention does not add its prefix a second time.
    op.create_check_constraint(op.f('ck_rounds_cut_positive'), 'rounds', 'cut >= 1')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f('ck_rounds_cut_positive'), 'rounds', type_='check')
    op.drop_column('rounds', 'cut')
