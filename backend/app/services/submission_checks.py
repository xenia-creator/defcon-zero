"""The background check that runs after a submission is saved.

POST /submissions answers straight away, and the client polls for the result.
This file then moves the submission from pending to running to accepted or
rejected. It runs outside any request, so it opens its own database sessions:
the request's session belongs to the request and may already be closed.
"""

import asyncio
import logging

from app.core.database import SessionLocal
from app.repositories import rounds as rounds_repository
from app.repositories import submissions as submissions_repository
from app.schemas.rounds import Game
from app.schemas.submissions import SubmissionCheck
from app.services import engine_bridge

logger = logging.getLogger(__name__)

# A fixed message: exception text can reveal internals, so it goes to the log
# and never to the team.
CRASH_ERROR = "The check failed unexpectedly. Please submit again."


async def mark_running(submission_id: int) -> tuple[str, Game]:
    """Set the status to running. Returns the code and game the check needs.

    The session closes on return, so no database connection is held for the
    seconds the check takes. With many teams submitting, the pool would run out.
    """
    async with SessionLocal() as db:
        submission = await submissions_repository.get_by_id(db, submission_id)
        round_row = await rounds_repository.get_by_id(db, submission.round_id)
        submission.status = "running"
        await db.commit()
        return submission.code, round_row.game


async def save_result(submission_id: int, check: SubmissionCheck) -> None:
    """Store the check, and set the final status in the same commit.

    Saved together, so a client can never see accepted with no check attached.
    """
    async with SessionLocal() as db:
        submission = await submissions_repository.get_by_id(db, submission_id)
        submission.status = "rejected" if check.error else "accepted"
        submission.check = check.model_dump()
        await db.commit()


async def run_check(submission_id: int) -> None:
    """Check one submission from start to finish. Never raises an Exception.

    A background task has no client to report to, so an error raised here would
    disappear and leave the submission stuck at running, with the team polling
    forever. Catching everything guarantees it reaches a final status.
    """
    try:
        code, game = await mark_running(submission_id)
        check = await engine_bridge.check_submission(code, game)
    except Exception:
        # logger.exception records the full traceback for debugging.
        logger.exception("Check crashed for submission %s", submission_id)
        check = SubmissionCheck(error=CRASH_ERROR, test_results=[])
    try:
        await save_result(submission_id, check)
    except Exception:
        # Nothing more can be done if the database itself is failing.
        logger.exception("Could not save check for submission %s", submission_id)


async def find_unfinished_checks() -> list[int]:
    """Return submissions a server restart left at pending or running.

    Checks live in the server's memory, so a restart loses them while their rows
    stay unfinished. A failure here is logged rather than raised: with the
    database down, the server should still start and report that through /health.
    """
    try:
        async with SessionLocal() as db:
            return await submissions_repository.list_unfinished_ids(db)
    except Exception:
        logger.exception("Could not look for unfinished checks")
        return []


async def run_checks(submission_ids: list[int]) -> None:
    """Run these checks, so teams do not have to resubmit after a restart.

    All start at once, because the engine bridge's thread pool already limits how
    many run at a time. Running a check again is harmless: a bot is only tested,
    and the final status overwrites whatever the interrupted run left.
    """
    await asyncio.gather(*(run_check(submission_id) for submission_id in submission_ids))
