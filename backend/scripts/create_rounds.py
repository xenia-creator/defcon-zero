"""Create the event's three rounds, all waiting, from app/core/rounds.py.

This is how rounds get into the database, because the API has no route to add
one. Run it from the backend folder, after the migrations:

    python -m scripts.create_rounds

The -m form matters for the same reason as in create_users.py: it puts the
backend folder on Python's import path.

It is safe to run twice. A round whose number already exists is skipped and left
untouched, so running this mid-event cannot reset a round. That also means an
edit to app/core/rounds.py does not reach a round that already exists.

All new rounds are saved in one transaction. They go to the database in
DATABASE_URL, whose name is printed first.
"""

import asyncio
import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import SessionLocal, engine
from app.services.rounds import create_missing_rounds


async def save_rounds() -> None:
    """Create the missing rounds in one transaction, then report what happened."""
    async with SessionLocal() as db:
        results = await create_missing_rounds(db)
        await db.commit()

    # Printed only after the commit, so "created" is never shown for a failed run.
    for definition, created in results:
        outcome = "created" if created else "skipped (already exists)"
        print(f"{outcome}: round {definition.number} ({definition.game})")
    created_count = sum(created for _, created in results)
    print(f"Done: {created_count} created, {len(results) - created_count} skipped.")


async def run() -> None:
    print(f"Database: {engine.url.database}")
    try:
        await save_rounds()
    finally:
        # Closes the pool before asyncio.run ends. Connections left open would
        # be cleaned up after the event loop has gone, which raises warnings.
        await engine.dispose()


def main() -> int:
    try:
        asyncio.run(run())
    except (SQLAlchemyError, OSError) as exc:
        # OSError covers the database being unreachable. Only the error type is
        # shown, because a driver's message can include connection details.
        print(f"Database error: {type(exc).__name__}. Nothing was saved.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
