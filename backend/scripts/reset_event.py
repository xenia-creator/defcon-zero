"""Wipe a dry run's data before the real event. User accounts are kept by default.

Deletes every match, standing, submission and team, and sets every round back to
waiting with no times and no seed. Accounts stay, so teams log in as before and
claim their territory again. Run it from the backend folder:

    python -m scripts.reset_event --yes

If the dry run used test accounts, add --delete-team-accounts. Every account with
role team is then deleted too, and organiser accounts are kept. Load the real
team accounts afterwards with create_users.py:

    python -m scripts.reset_event --yes --delete-team-accounts

There is no undo, so it does nothing without --yes. It always prints the name of
the database in DATABASE_URL first, so you can see which one it is about to wipe.

STOP THE SERVER FIRST. A running server may be checking submissions or playing a
round in the background, and would write rows straight back after the reset.

Everything happens in one transaction: if any step fails, nothing is changed.
"""

import argparse
import asyncio
import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import SessionLocal, engine
from app.services.event_reset import reset_event


def parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    """Read the command line. argv is None for the real one, or a list in tests."""
    parser = argparse.ArgumentParser(
        description="Delete all matches, standings, submissions and teams, "
        "and set every round back to waiting. User accounts are kept by default."
    )
    parser.add_argument(
        "--yes", action="store_true", help="really wipe the data (required)"
    )
    parser.add_argument(
        "--delete-team-accounts",
        action="store_true",
        help="also delete every account with role team (organisers are kept)",
    )
    return parser.parse_args(argv)


async def wipe(delete_team_accounts: bool) -> None:
    """Reset in one transaction, then report what happened."""
    async with SessionLocal() as db:
        counts = await reset_event(db, delete_team_accounts)
        await db.commit()

    # Printed only after the commit, so a failed run never reports deletions.
    print(f"Deleted {counts.matches} matches.")
    print(f"Deleted {counts.standings} standings.")
    print(f"Deleted {counts.submissions} submissions.")
    print(f"Deleted {counts.teams} teams.")
    print(f"Reset {counts.rounds} rounds to waiting.")
    if delete_team_accounts:
        print(f"Deleted {counts.team_accounts} team accounts.")
        print("Done. Organiser accounts were kept.")
    else:
        print("Done. User accounts were kept.")


async def run(delete_team_accounts: bool = False) -> None:
    try:
        await wipe(delete_team_accounts)
    finally:
        # Closes the pool before asyncio.run ends, as in create_rounds.py.
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    # Printed before the --yes check, so a run without it shows which database
    # it would have wiped. Reading the name does not connect to the database.
    # flush=True sends it out now. When output goes to a pipe or a log, Python
    # holds printed text back, and it could otherwise appear after the messages.
    print(f"Database: {engine.url.database}", flush=True)
    if not arguments.yes:
        print(
            "Refusing to run without --yes. This deletes all matches, standings, "
            "submissions and teams in the database above. Nothing was changed.",
            file=sys.stderr,
        )
        return 1

    try:
        asyncio.run(run(arguments.delete_team_accounts))
    except (SQLAlchemyError, OSError) as exc:
        # Only the error type is shown, because a driver's message can include
        # connection details.
        print(f"Database error: {type(exc).__name__}. Nothing was changed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
