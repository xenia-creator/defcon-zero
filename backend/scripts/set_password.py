"""Set a new password for an existing account, typed in without being shown.

create_users.py never changes a password, as it skips usernames that already
exist. This script is how a password is changed, for example a new organiser
password before the real event. Run it from the backend folder:

    python -m scripts.set_password alice

It prints the database in DATABASE_URL first, then asks for the new password
twice. getpass reads what is typed without showing it on screen, so it is never
in the terminal's scrollback, and it is not in the shell history either, as it
would be if it were passed as an argument. The password is never printed.

Tokens issued before the change keep working until they expire (12 hours), as a
token is not checked against the password. Changing JWT_SECRET ends them all.
"""

import argparse
import asyncio
import getpass
import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import SessionLocal, engine
from app.services.auth import change_password, is_usable_text


class PasswordInputError(Exception):
    """The typed password cannot be used. The message is safe to print."""


def parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    """Read the command line. argv is None for the real one, or a list in tests."""
    parser = argparse.ArgumentParser(description="Set a new password for an account.")
    parser.add_argument("username", help="the account to change (case does not matter)")
    return parser.parse_args(argv)


def ask_for_password() -> str:
    """Ask twice, and return the password only if both entries match.

    Typing it twice catches a typo, which would otherwise lock the organiser out
    with a password nobody knows. The messages never repeat what was typed.
    """
    password = getpass.getpass("New password: ")
    if not password:
        raise PasswordInputError("The password is empty.")
    if not is_usable_text(password):
        raise PasswordInputError("The password contains an unusable character.")
    if getpass.getpass("Type it again: ") != password:
        raise PasswordInputError("The two passwords do not match.")
    return password


async def save_password(username: str, password: str) -> bool:
    """Store the new password. Return False if there is no such account."""
    try:
        async with SessionLocal() as db:
            changed = await change_password(db, username, password)
            await db.commit()
        return changed
    finally:
        # Closes the pool before asyncio.run ends, as in create_rounds.py.
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    # Printed before the prompt, so you can stop with Ctrl+C before typing a
    # password into the wrong database. Reading the name does not connect.
    # flush=True sends it out now. When output goes to a pipe or a log, Python
    # holds printed text back, and it could otherwise appear after the messages.
    print(f"Database: {engine.url.database}", flush=True)

    try:
        password = ask_for_password()
    except PasswordInputError as exc:
        print(f"{exc} Nothing was changed.", file=sys.stderr)
        return 1

    try:
        changed = asyncio.run(save_password(arguments.username, password))
    except (SQLAlchemyError, OSError) as exc:
        # Only the error type is shown. SQLAlchemy's message includes the values
        # of the failed query, which here would contain the new password hash.
        print(f"Database error: {type(exc).__name__}. Nothing was changed.", file=sys.stderr)
        return 1

    if not changed:
        print(f"No account named {arguments.username}. Nothing was changed.", file=sys.stderr)
        return 1
    print(f"Password changed for {arguments.username}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
