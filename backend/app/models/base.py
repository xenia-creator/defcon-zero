"""Shared base for all models. Base.metadata is the list of tables Alembic compares
against the real database when it generates a migration.
"""

from typing import Any, get_args

from sqlalchemy import CheckConstraint, MetaData
from sqlalchemy.orm import DeclarativeBase

# A naming convention gives every constraint a predictable name. Without one
# Postgres invents names, and a later migration cannot reliably drop a constraint
# it cannot name. Unique constraints are named by hand in each model instead,
# because services will match those names to contract error codes.
NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def allowed_values(column: str, literal: Any) -> CheckConstraint:
    """Make the database reject any value outside a schema's Literal type.

    Status-like columns are plain strings with a CHECK constraint, not native
    Postgres enums, because changing a CHECK in a migration is a simple drop and
    create. Reading the values from the schema Literal means each contract
    spelling is still written in only one place.
    """
    quoted = ", ".join(f"'{value}'" for value in get_args(literal))
    return CheckConstraint(f"{column} IN ({quoted})", name=column)
