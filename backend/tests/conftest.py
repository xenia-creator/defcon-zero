"""Shared test setup: points the app at defcon_test and gives tests their tools.

Tests call the real app, with the real services and a real Postgres database,
and nothing is faked. That is what proves the constraints, the row lock and the
error mapping work. Claiming commits, and the concurrency tests need several
connections, so tests really do write. They are kept away from real data like this:

1. The swap below happens before anything imports app.core.database, because the
   engine reads its URL once, at import.
2. It stops unless the configured test database is named defcon_test.
3. prepare_database then asks Postgres which database it is really connected to,
   and stops the run if the answer is anything else, before any table is wiped.
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.settings import settings

TEST_DATABASE_NAME = "defcon_test"
BACKEND_FOLDER = Path(__file__).resolve().parents[1]

if settings.test_database_url is None:
    pytest.exit("TEST_DATABASE_URL is not set in backend/.env.", returncode=1)
test_url = settings.test_database_url.get_secret_value()
if make_url(test_url).database != TEST_DATABASE_NAME:
    pytest.exit(f"TEST_DATABASE_URL must use {TEST_DATABASE_NAME}.", returncode=1)
settings.database_url = settings.test_database_url

# These imports must stay below the swap, as they create the engine.
from app.core.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.auth import create_account  # noqa: E402

PASSWORD = "correct-horse-battery"


async def wipe_tables() -> None:
    """Empty every table the tests write to.

    CASCADE also empties the tables that point at these, which are unused so far.
    """
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE users, teams CASCADE"))


@pytest.fixture(scope="session")
def migrated_database() -> None:
    """Bring defcon_test up to the latest migration, once per run.

    A fixture is setup that pytest runs for the tests that ask for it, here once
    for the whole run. alembic/env.py reads the same settings object, so this
    migrates the database chosen above. It is a plain function, not async, because
    Alembic starts its own event loop.
    """
    command.upgrade(Config(BACKEND_FOLDER / "alembic.ini"), "head")


@pytest.fixture(scope="session", autouse=True)
async def prepare_database(migrated_database: None) -> AsyncIterator[None]:
    """Confirm the real connection is to defcon_test, and close the pool at the end."""
    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT current_database()"))
        connected_to = result.scalar_one()
    if connected_to != TEST_DATABASE_NAME:
        pytest.exit(f"Refusing to run tests against {connected_to}.", returncode=1)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_tables(prepare_database: None) -> AsyncIterator[None]:
    """Give each test empty tables, and leave none behind.

    autouse means it applies to every test without being asked for. Wiping before
    the test also clears anything left by a run that crashed.
    """
    await wipe_tables()
    yield
    await wipe_tables()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client wired straight into the app, with no server or network.

    raise_app_exceptions=False returns a crash as the 500 a real client would see,
    rather than raising it inside the test.
    """
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def create_user(username: str, role: str = "team") -> None:
    """Add an account the same way scripts/create_users.py does."""
    async with SessionLocal() as db:
        await create_account(db, username, PASSWORD, role)
        await db.commit()


@pytest.fixture
def log_in_new_user(
    client: httpx.AsyncClient,
) -> Callable[..., Awaitable[dict[str, str]]]:
    """Return a helper that creates a user, logs in and gives back auth headers."""

    async def create_and_log_in(
        username: str = "team_a", role: str = "team"
    ) -> dict[str, str]:
        await create_user(username, role)
        response = await client.post(
            "/auth/login", json={"username": username, "password": PASSWORD}
        )
        return bearer(response.json()["access_token"])

    return create_and_log_in


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def assert_error(response: httpx.Response, status_code: int, code: str) -> None:
    """Check the status, and that the body has exactly the contract's error shape."""
    assert response.status_code == status_code
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
