"""Database query behind GET /health. All queries live in repositories."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def ping(db: AsyncSession) -> None:
    """Run the cheapest possible query. Raises if the database cannot answer."""
    await db.execute(text("SELECT 1"))
