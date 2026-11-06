# Rules for building this backend

## Who I am
I own this backend and review every line. I need to understand and explain all of it.

## How to write code
- Build only what the current step asks. No extra features, no unrelated changes.
- Every file starts with a short comment: what it is for and how it fits the app.
- Comment the WHY, not just the what. Explain each design decision where it happens.
- When a concept appears for the first time (dependency injection, async sessions, unique constraints, JWT claims, background tasks), explain it in a comment.
- Keep functions small and clearly named.
- When done, summarise: files changed, what each does, and what I should test.

## Architecture
- FastAPI app in backend/app.
- Layers: api (routers) -> services (business rules) -> repositories (database queries) -> models.
- Routers only parse input, call a service and return a schema. No business logic in routers.
- All database queries live in repositories.
- The game engine is the separate package in /engine. Import it, never modify it.
- The API contract is docs/api.md. Follow it exactly, including routes, field names, status values and error codes. Never change it without asking me.
- Every error uses the shape {"error": {"code": "...", "message": "..."}}.

## Stack
Python 3.14, FastAPI, Pydantic v2, pydantic-settings, SQLAlchemy 2.0 async with asyncpg, Alembic, PostgreSQL 18, PyJWT, pwdlib with Argon2, pytest with httpx.