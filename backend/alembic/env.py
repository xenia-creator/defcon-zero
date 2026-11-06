"""Alembic's runtime script: connects to the database and runs migrations.

Alembic is the version control for the database schema. Each file in versions/
moves the schema one step forward or back, and the alembic_version table records
which step this database is on. Run from the backend folder:

  alembic revision --autogenerate -m "what changed"   generate a migration
  alembic upgrade head                                apply all migrations

Based on Alembic's async template, changed to take its URL from app settings
and its table list from the models.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.core.settings import settings

# Importing from app.models, not app.models.base, loads every model.
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Autogenerate compares these tables to the real database and writes the difference.
target_metadata = Base.metadata

# Read from settings so the password exists only in .env, not in alembic.ini.
# It is passed straight to the engine because config.set_main_option would treat
# a "%" in the password as ini interpolation and crash.
DATABASE_URL = settings.database_url.get_secret_value()


def run_migrations_offline() -> None:
    """Write the migration SQL to the screen without connecting (alembic upgrade --sql)."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run the migrations over a connection from an async engine.

    Alembic itself is synchronous, so run_sync bridges it onto the async
    connection. NullPool skips connection pooling: this is a one-off command
    that opens a single connection and exits.
    """
    connectable = create_async_engine(DATABASE_URL, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
