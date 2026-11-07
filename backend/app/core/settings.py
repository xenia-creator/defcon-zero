"""App configuration, read once at startup from environment variables and backend/.env.

Secrets live outside the code so they never reach git. Everything that needs a
setting imports the `settings` object below rather than reading the environment
itself, which keeps the list of required values in one place.
"""

from pathlib import Path
from typing import Annotated

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# An absolute path, so .env is found whichever folder the server, Alembic or a
# test is started from. A bare ".env" would be looked up in the current folder.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Field names match the variable names, ignoring case.

    A real environment variable beats the value in .env, so a deploy can set
    these without a file. The two required fields have no default on purpose: if
    one is missing the app refuses to start, rather than running with a fake secret.
    """

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # SecretStr prints as "**********", so a stray log line cannot leak the
    # value. Code that really needs it must call .get_secret_value().
    # The database URL counts as a secret because it contains the password.
    database_url: SecretStr
    jwt_secret: SecretStr
    # Only tests/conftest.py reads this. It is optional because a deployed server
    # has no test database.
    test_database_url: SecretStr | None = None
    # The browser origins allowed to call this API (see CORS in app/main.py),
    # written in .env as one comma-separated line. The default is the frontend's
    # Vite dev server, so local development works without setting it. The event
    # server sets it to the frontend's real address.
    # NoDecode stops pydantic-settings reading a list setting as JSON, its default,
    # so the plain comma-separated text reaches split_origins below instead.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        """Turn "a, b" into ["a", "b"], dropping spaces and empty entries.

        A trailing slash is removed too, because the browser sends the Origin
        header without one, and "http://host/" would never match "http://host".
        """
        if isinstance(value, str):
            return [
                origin.strip().rstrip("/")
                for origin in value.split(",")
                if origin.strip()
            ]
        return value


settings = Settings()
