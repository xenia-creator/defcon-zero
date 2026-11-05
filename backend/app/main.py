"""Application entry point: builds the FastAPI app and connects its parts.

Run from the backend folder with:  uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.errors import register_error_handling

app = FastAPI(title="DEFCON Zero API")

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
