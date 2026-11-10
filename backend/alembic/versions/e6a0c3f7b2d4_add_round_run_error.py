"""add round run_error

rounds.run_error: why the last background run of a running round failed, or
null. GET /admin/overview reads it to tell organisers whether the matches are
still playing or the run failed and needs a retry (docs/api.md section 7, v5.6).

Nullable with no default, so every existing round starts as "no failure", which
is right: a round left running by an older server is resumed at startup.

Revision ID: e6a0c3f7b2d4
Revises: d5f9b2e6a1c3
Create Date: 2026-11-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e6a0c3f7b2d4'
down_revision: Union[str, Sequence[str], None] = 'd5f9b2e6a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('rounds', sa.Column('run_error', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('rounds', 'run_error')
