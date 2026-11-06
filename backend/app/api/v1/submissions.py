"""Routes for bot submissions (docs/api.md section 5)."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.database import get_db
from app.schemas.ids import MAX_DATABASE_ID
from app.schemas.submissions import Submission, SubmissionCreate, SubmissionsResponse
from app.services import submission_checks
from app.services import submissions as submissions_service

router = APIRouter(prefix="/submissions", tags=["submissions"])


# 202 Accepted means "received, work still to do": the check runs after the
# response is sent, and the client polls GET /submissions/{id} for the result.
@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_submission(
    submission: SubmissionCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    response: Response,
    background_tasks: BackgroundTasks,
    # Annotated attaches FastAPI's instructions to a normal type. Header(...)
    # says "read this from a request header". The alias is needed because
    # Python names cannot contain the hyphen in "Idempotency-Key".
    # max_length is needed because Postgres cannot index a very long value, so
    # an oversized key would crash the insert instead of being a clean 400.
    idempotency_key: Annotated[
        str | None, Header(alias="Idempotency-Key", min_length=1, max_length=255)
    ] = None,
) -> Submission:
    saved, created = await submissions_service.create_submission(
        db, user, submission, idempotency_key
    )
    # A background task runs after the response has been sent, in this same
    # server process. That is how the team gets its 202 straight away while the
    # check takes seconds. It is added only here, after the commit in the service,
    # so the check can never start on a row that was not saved.
    if created:
        background_tasks.add_task(submission_checks.run_check, saved.id)
    else:
        # A repeated key created nothing, so the contract answers 200, not 202,
        # and the original submission's check is not run a second time.
        response.status_code = status.HTTP_200_OK
    return saved


# round_id has no default, so FastAPI treats it as a required query parameter
# and a call without it gets 400 VALIDATION_ERROR.
@router.get("")
async def list_submissions(
    round_id: Annotated[int, Query(ge=1, le=MAX_DATABASE_ID)],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SubmissionsResponse:
    return await submissions_service.list_submissions(db, user, round_id)


@router.get("/{submission_id}")
async def get_submission(
    # Not limited here: the service answers an out-of-range id with 404, as the
    # contract says for an id that does not exist.
    submission_id: int,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Submission:
    return await submissions_service.get_submission(db, user, submission_id)
