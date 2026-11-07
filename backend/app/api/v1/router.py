"""Combines the feature routers into one, so main.py has a single thing to attach.

The folder is called v1, but the router has no "/api/v1" URL prefix on purpose:
docs/api.md defines routes such as /auth/login, and the contract must be followed
exactly. "v1" only organises the code.
"""

from fastapi import APIRouter

from app.api.v1 import admin, auth, health, rounds, standings, submissions, teams

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(teams.router)
api_router.include_router(rounds.router)
api_router.include_router(submissions.router)
api_router.include_router(standings.router)
api_router.include_router(admin.router)
