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
from app.services import submission_checks


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Resume interrupted bot checks. Code before `yield` runs at server startup.

    The list is read before `yield` because no request is served until then, so
    it cannot catch a new submission and check it twice. The checks themselves
    run as a separate task, so a long list does not delay the server starting.

    ASSUMES ONE SERVER PROCESS. A second process starting up would see the first
    one's checks as unfinished and run them again. Moving to several processes
    means replacing this, along with the in-process checks (docs/api.md section 9).
    """
    submission_ids = await submission_checks.find_unfinished_checks()
    resuming = asyncio.create_task(submission_checks.run_checks(submission_ids))
    yield
    # Code after `yield` runs at shutdown. A cancelled check keeps its status, so
    # the next startup picks it up again.
    resuming.cancel()
    with suppress(asyncio.CancelledError):
        await resuming


app = FastAPI(title="DEFCON Zero API", lifespan=lifespan)

# Order matters: the middleware added last runs outermost. Error handling goes
# first so CORSMiddleware wraps it and can add its headers to 500 responses.
register_error_handling(app)

# CORS is the browser rule that stops a page on one origin (the frontend) from
# reading responses from another (this API) unless the API allows it.
# Every origin is allowed for now and should be narrowed before the event.
# allow_credentials stays off because auth uses a Bearer header, not cookies.
# allow_headers must cover Authorization and Idempotency-Key, which the browser
# asks permission for in a preflight OPTIONS request before sending them.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
