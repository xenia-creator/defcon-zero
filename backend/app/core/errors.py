"""Error handling for the whole app.

The contract says every error, on every route, has the shape
{"error": {"code": "...", "message": "..."}}. FastAPI's defaults use other
shapes, so each way a request can fail is routed through error_response() here:

  AppError                 errors we raise on purpose (TERRITORY_TAKEN, ...)
  RequestValidationError   bad body, query or path values -> 400
  HTTPException            raised by the framework, such as an unknown URL
  anything else            a bug -> 500 INTERNAL_ERROR
"""

import logging
from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.errors import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)

# HTTP statuses the framework raises by itself, mapped to contract codes.
FRAMEWORK_ERROR_CODES: dict[int, str] = {
    400: "VALIDATION_ERROR",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
}


class AppError(Exception):
    """An expected failure that maps to one contract error code.

    Services raise this instead of building HTTP responses, so business rules
    stay independent of HTTP. Raising also stops the request straight away,
    however deep in the call stack the problem was found.

    Example: raise AppError("TERRITORY_TAKEN", "This territory has already been claimed.", 409)
    """

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def error_response(
    status_code: int,
    code: str,
    message: str,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """Build the contract's error body. Every handler below ends up here."""
    body = ErrorResponse(error=ErrorDetail(code=code, message=message))
    return JSONResponse(
        status_code=status_code, content=body.model_dump(), headers=headers
    )


async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message)


def describe_validation_error(exc: RequestValidationError) -> str:
    """Summarise failures as "body.round_id: Field required; ...".

    Only each error's location and text are used. Pydantic also records the
    rejected input, and repeating that could echo a password back in a response.
    """
    parts = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"])
        parts.append(f"{location}: {error['msg']}")
    return "; ".join(parts)


async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # FastAPI's default is 422, but the contract uses 400 for validation and
    # keeps 422 for IDEMPOTENCY_KEY_REUSED.
    return error_response(400, "VALIDATION_ERROR", describe_validation_error(exc))


async def handle_http_exception(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    # Registered for Starlette's class, not FastAPI's subclass, because routing
    # failures such as an unknown URL raise the Starlette one.
    if exc.status_code not in FRAMEWORK_ERROR_CODES:
        # Unmapped means we have no contract code for it, so treat it as a bug.
        logger.error("Unmapped HTTP error %s: %s", exc.status_code, exc.detail)
        return unexpected_error_response()
    code = FRAMEWORK_ERROR_CODES[exc.status_code]
    # exc.headers is passed on because HTTP requires a 405 to list the allowed
    # methods in an Allow header, and the framework puts that header here.
    return error_response(exc.status_code, code, str(exc.detail), exc.headers)


def unexpected_error_response() -> JSONResponse:
    # A fixed message: exception text can reveal internals, so it goes to the
    # log and never to the client.
    return error_response(500, "INTERNAL_ERROR", "An unexpected error occurred.")


async def catch_unexpected_errors(request: Request, call_next) -> Response:
    """Turn any unhandled exception into a 500 INTERNAL_ERROR.

    Middleware is code that wraps every request: it runs before the route and
    can see what comes back. This is middleware, not an exception handler,
    because Starlette runs an Exception handler outside all other middleware.
    The 500 would then skip CORSMiddleware and have no CORS headers, so the
    browser would hide it and the frontend would see a network failure instead
    of INTERNAL_ERROR. Running inside CORSMiddleware avoids that.
    """
    try:
        return await call_next(request)
    except Exception:
        # logger.exception records the full traceback for debugging.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return unexpected_error_response()


def register_error_handling(app: FastAPI) -> None:
    """Attach everything above to the app. Called once from main.py."""
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.middleware("http")(catch_unexpected_errors)
