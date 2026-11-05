"""The contract's error body. core/errors.py builds every error response from it."""

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    # The frontend branches on `code`; `message` is for humans and may change.
    code: str
    message: str


class ErrorResponse(BaseModel):
    """Serialises to {"error": {"code": "...", "message": "..."}}."""

    error: ErrorDetail
