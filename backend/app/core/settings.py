"""App configuration, read once at startup from environment variables and backend/.env.

Secrets live outside the code so they never reach git. Everything that needs a
setting imports the `settings` object below rather than reading the environment
itself, which keeps the list of required values in one place.
"""

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# An absolute path, so .env is found whichever folder the server, Alembic or a
# test is started from. A bare ".env" would be looked up in the current folder.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Field names match the variable names, ignoring case.

    A real environment variable beats the value in .env, so a deploy can set
    these without a file. Neither field has a default on purpose: if one is
    missing the app refuses to start, rather than running with a fake secret.
    """

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # SecretStr prints as "**********", so a stray log line cannot leak the
    # value. Code that really needs it must call .get_secret_value().
    # The database URL counts as a secret because it contains the password.
    database_url: SecretStr
    jwt_secret: SecretStr


settings = Settings()
