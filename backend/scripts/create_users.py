"""Create team and organiser accounts from a CSV file.

This is how accounts get into the database, because the API has no sign-up route.
Run it from the backend folder:

    python -m scripts.create_users path/to/users.csv

The -m form matters: it puts the backend folder on Python's import path, so
`import app` works. Running the file by its path would not.

The file needs a header line with these three columns:

    username,password,role
    team_kremlin,some-password,team
    alice,another-password,organiser

It is safe to run twice. Usernames that already exist are skipped and keep their
current password, so re-running cannot reset a password a team is using.

The whole file is checked before anything is written, and all new accounts are
saved in one transaction, so a bad file or a failed run leaves the database as it
was. Accounts go to the database in DATABASE_URL, whose name is printed first.

Passwords are never printed. That is why error messages give line numbers and do
not repeat values: in a file with its columns out of order, the value in the role
column, or a header line that is missing, could be someone's password.
"""

import argparse
import asyncio
import csv
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import get_args

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import SessionLocal, engine
from app.schemas.auth import Role
from app.services.auth import create_account, is_usable_text, normalise_username

REQUIRED_COLUMNS = {"username", "password", "role"}
# Taken from the Role type, so this list cannot drift from the API and database.
ALLOWED_ROLES = get_args(Role)


@dataclass(frozen=True)
class Account:
    """One validated line of the CSV."""

    username: str
    # repr=False keeps the password out of the text Python would show if this
    # object were ever printed or logged.
    password: str = field(repr=False)
    role: str


class CsvFileError(Exception):
    """The file cannot be used. The message is safe to print."""


def find_problem(row: dict, first_seen: dict[str, int]) -> str | None:
    """Return what is wrong with one CSV row, or None if it is fine.

    first_seen maps each username so far to its line. Usernames are compared after
    lowercasing, because "Team_A" and "team_a" would be the same account.
    """
    # csv.DictReader stores surplus values under None, and fills missing ones with None.
    if None in row or None in row.values():
        return "expected exactly 3 columns"
    username = row["username"].strip()
    if not username:
        return "username is empty"
    if not row["password"]:
        return "password is empty"
    if not (is_usable_text(username) and is_usable_text(row["password"])):
        return "username or password contains an unusable character"
    if row["role"].strip() not in ALLOWED_ROLES:
        return f"role must be one of: {', '.join(ALLOWED_ROLES)}"
    first_line = first_seen.get(normalise_username(username))
    if first_line is not None:
        return f"same username as line {first_line} (usernames ignore case)"
    return None


def read_accounts(path: Path) -> list[Account]:
    """Read and validate the whole file. Raises CsvFileError listing every problem."""
    accounts: list[Account] = []
    problems: list[str] = []
    first_seen: dict[str, int] = {}

    # utf-8-sig also accepts the invisible marker Excel puts at the start of a
    # CSV, which would otherwise become part of the first column's name.
    # newline="" leaves line endings to the csv module, as its docs require.
    try:
        with path.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            if set(reader.fieldnames or []) != REQUIRED_COLUMNS:
                raise CsvFileError("The first line must be: username,password,role")
            for row in reader:
                problem = find_problem(row, first_seen)
                if problem:
                    problems.append(f"line {reader.line_num}: {problem}")
                    continue
                username = normalise_username(row["username"].strip())
                first_seen[username] = reader.line_num
                accounts.append(Account(username, row["password"], row["role"].strip()))
    except OSError as exc:
        raise CsvFileError(f"Cannot read {path}: {exc.strerror}") from exc
    except (UnicodeDecodeError, csv.Error):
        # The original messages can quote the file's contents, so they are dropped.
        raise CsvFileError(f"{path} is not a valid UTF-8 CSV file.") from None

    if problems:
        raise CsvFileError("\n".join(problems))
    return accounts


async def save_accounts(accounts: list[Account]) -> None:
    """Create the accounts in one transaction, then report what happened."""
    results: list[tuple[str, bool]] = []
    async with SessionLocal() as db:
        for account in accounts:
            created = await create_account(
                db, account.username, account.password, account.role
            )
            results.append((account.username, created))
        await db.commit()

    # Printed only after the commit, so "created" is never shown for a failed run.
    for username, created in results:
        print(f"{'created' if created else 'skipped (already exists)'}: {username}")
    created_count = sum(created for _, created in results)
    print(f"Done: {created_count} created, {len(results) - created_count} skipped.")


async def run(path: Path) -> None:
    accounts = read_accounts(path)
    print(f"Database: {engine.url.database}")
    try:
        await save_accounts(accounts)
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create accounts from a CSV file.")
    parser.add_argument("csv_file", type=Path, help="columns: username,password,role")
    arguments = parser.parse_args()

    try:
        asyncio.run(run(arguments.csv_file))
    except CsvFileError as exc:
        print(f"{exc}\nNothing was saved.", file=sys.stderr)
        return 1
    except SQLAlchemyError as exc:
        # Only the error type is shown. SQLAlchemy's message includes the values
        # of the failed query, which here would contain a password hash.
        print(f"Database error: {type(exc).__name__}. Nothing was saved.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
