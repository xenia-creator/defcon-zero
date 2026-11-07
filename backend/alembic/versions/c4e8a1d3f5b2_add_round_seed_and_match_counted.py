"""add round seed and match counted

Two columns the tournament run needs:

- rounds.seed: chosen at random when a round starts, and kept secret. It picks
  the number of turns and seeds the engine, so a retried or resumed run plays
  exactly the same matches. Null until the round starts.
- matches.counted: the engine's own flag for whether a match counts towards the
  totals. Forfeits, and every match of a bot the engine disqualified, are stored
  but do not count.

Revision ID: c4e8a1d3f5b2
Revises: b7d2e4f1c9a0
Create Date: 2026-11-07 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c4e8a1d3f5b2'
down_revision: Union[str, Sequence[str], None] = 'b7d2e4f1c9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # BigInteger because the seed is a 63-bit random number, which does not fit
    # in Postgres's 32-bit integer.
    op.add_column('rounds', sa.Column('seed', sa.BigInteger(), nullable=True))
    # A NOT NULL column cannot be added to a table that has rows unless each row
    # gets a value. No code has written matches yet, but the temporary default
    # makes this safe either way. It is then dropped, so the app must always say
    # whether a match counts rather than relying on a default.
    op.add_column(
        'matches',
        sa.Column('counted', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column('matches', 'counted', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('matches', 'counted')
    op.drop_column('rounds', 'seed')
