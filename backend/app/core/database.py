"""Database connection: the shared engine, the session factory and get_db.

The engine owns a pool of open connections and is created once for the whole
app. A session is one request's unit of work and borrows a connection from that
pool. Repositories run their queries through a session.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.settings import settings

# "Async" means that while a query waits on the database, the server is free to
# handle other requests instead of blocking. That matters on event day, when
# every team and the war map are polling at the same time.
engine = create_async_engine(
    settings.database_url.get_secret_value(),
    # Tests each pooled connection before reuse, so a database restart costs one
    # quick reconnect instead of an error on the next request.
    pool_pre_ping=True,
    # asyncpg waits 60 seconds by default. With the database down, /health
    # should fail quickly rather than hang for a minute.
    connect_args={"timeout": 5},
)

# expire_on_commit=False keeps loaded values readable after a commit. The default
# would reload them on next access, and that hidden query cannot run in async
# code: it would crash while a router was turning a model into a response.
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """Give one request its own session, and always close it afterwards.

    This is a FastAPI dependency. Dependency injection means a route declares
    what it needs, as `db: Annotated[AsyncSession, Depends(get_db)]`, and FastAPI
    calls this function and passes the result in. Routes never build their own
    session, and tests can swap this function out for a different one.

    Code before `yield` runs before the route and code after it runs once the
    response is done, so `async with` returns the connection to the pool even if
    the route raised.

    It does not commit. The service decides when its work is complete, and
    anything uncommitted is rolled back when the session closes.
    """
    async with SessionLocal() as session:
        yield session
