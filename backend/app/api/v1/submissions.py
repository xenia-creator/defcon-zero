"""Stub routes for bot submissions (docs/api.md section 5)."""

from typing import Annotated

from fastapi import APIRouter, Header, status

from app.api.v1.stub_data import (
    FAKE_ACCEPTED_SUBMISSION,
    FAKE_PENDING_SUBMISSION,
    FAKE_SUBMISSIONS,
)
from app.schemas.submissions import Submission, SubmissionCreate, SubmissionsResponse

router = APIRouter(prefix="/submissions", tags=["submissions"])


# 202 Accepted means "received, work still to do": the check runs after the
# response is sent, and the client polls GET /submissions/{id} for the result.
@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_submission(
    submission: SubmissionCreate,
    # Annotated attaches FastAPI's instructions to a normal type. Header(...)
    # says "read this from a request header". The alias is needed because
    # Python names cannot contain the hyphen in "Idempotency-Key".
    # The stub has no stored keys, so it always returns 202. The contract's 200
    # replay and 422 IDEMPOTENCY_KEY_REUSED need the database.
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> Submission:
    return FAKE_PENDING_SUBMISSION


# round_id has no default, so FastAPI treats it as a required query parameter
# and a call without it gets 400 VALIDATION_ERROR.
@router.get("")
async def list_submissions(round_id: int) -> SubmissionsResponse:
    return FAKE_SUBMISSIONS


@router.get("/{submission_id}")
async def get_submission(submission_id: int) -> Submission:
    return FAKE_ACCEPTED_SUBMISSION
