"""Application entry point: builds the FastAPI app and connects its parts.

Run from the backend folder with:  uvicorn app.main:app --reload
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.errors import register_error_handling
from app.core.settings import settings
from app.services import round_runs, submission_checks


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Resume interrupted bot checks and round runs. Code before `yield` runs at startup.

    The lists are read before `yield` because no request is served until then, so
    they cannot catch a new submission or a newly started round and run it twice.
    The work itself runs as separate tasks, so a long list does not delay the
    server starting. The checks and the rounds run side by side: a resumed round
    waits for the checks in its own round to finish first, as after a normal start.

    ASSUMES ONE SERVER PROCESS. A second process starting up would see the first
    one's checks and rounds as unfinished and run them again. Moving to several
    processes means replacing this, along with the in-process checks (docs/api.md
    section 9).
    """
    submission_ids = await submission_checks.find_unfinished_checks()
    round_ids = await round_runs.find_running_rounds()
    resuming = [
        asyncio.create_task(submission_checks.run_checks(submission_ids)),
        asyncio.create_task(round_runs.run_rounds(round_ids)),
    ]
    yield
    # Code after `yield` runs at shutdown. A cancelled check keeps its status, and
    # a cancelled round stays running with nothing saved, so the next startup
    # picks both up again.
    for task in resuming:
        task.cancel()
    for task in resuming:
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="DEFCON Zero API", lifespan=lifespan)

# Order matters: the middleware added last runs outermost. Error handling goes
# first so CORSMiddleware wraps it and can add its headers to 500 responses.
register_error_handling(app)

# CORS is the browser rule that stops a page on one origin (the frontend) from
# reading responses from another (this API) unless the API allows it.
# Only the origins in the CORS_ORIGINS setting are allowed, so a page on any
# other site cannot use a visitor's browser to read this API. A request from
# another origin still reaches the app, but gets no CORS headers, so the browser
# hides the response from that page.
# allow_credentials stays off because auth uses a Bearer header, not cookies.
# allow_headers must cover Authorization and Idempotency-Key, which the browser
# asks permission for in a preflight OPTIONS request before sending them.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
