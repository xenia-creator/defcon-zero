"""Business rules for bot submissions: who can submit, when, and what is saved."""

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.round import Round
from app.models.submission import Submission as SubmissionRow
from app.models.team import Team
from app.models.user import User
from app.repositories import rounds as rounds_repository
from app.repositories import submissions as submissions_repository
from app.repositories import teams as teams_repository
from app.schemas.ids import MAX_DATABASE_ID
from app.schemas.submissions import (
    Submission,
    SubmissionCreate,
    SubmissionsResponse,
    SubmissionSummary,
)
from app.services.auth import ensure_team_account, is_usable_text

# Measured in bytes, not characters, because bytes are what the database stores
# and the sandbox parses. Generated bots are far smaller than this.
CODE_MAX_BYTES = 64 * 1024
BLOCKS_MAX_BYTES = 256 * 1024


def build_submission(row: SubmissionRow, server_time: datetime) -> Submission:
    """Turn a table row into the API's full Submission object."""
    return Submission(
        id=row.id,
        round_id=row.round_id,
        version=row.version,
        status=row.status,
        created_at=row.created_at,
        code=row.code,
        blocks=row.blocks,
        check=row.check,
        server_time=server_time,
    )


async def list_submissions(
    db: AsyncSession, user: User, round_id: int
) -> SubmissionsResponse:
    """Return the GET /submissions body: the caller's own team, and nobody else's.

    A user with no team has no submissions, so the list is simply empty. That
    covers organisers too, as this route is "own team only".
    """
    rows = []
    if user.team_id is not None:
        rows = await submissions_repository.list_for_team(db, user.team_id, round_id)
    return SubmissionsResponse(
        submissions=[
            SubmissionSummary(
                id=row.id,
                version=row.version,
                status=row.status,
                created_at=row.created_at,
            )
            for row in rows
        ],
        server_time=datetime.now(UTC),
    )


def can_view(user: User, row: SubmissionRow) -> bool:
    """Organisers can see any submission, and teams only their own."""
    return user.role == "organiser" or row.team_id == user.team_id


async def get_submission(db: AsyncSession, user: User, submission_id: int) -> Submission:
    """Return a full submission, or 404 NOT_FOUND.

    A missing submission and another team's get the same error, word for word.
    A 403 would confirm that the id exists, and any difference in the message
    would reveal the same thing.

    An out-of-range id is checked here, not in the route, because the contract's
    answer for an id that does not exist is 404 rather than a validation error.
    """
    row = None
    if 1 <= submission_id <= MAX_DATABASE_ID:
        row = await submissions_repository.get_by_id(db, submission_id)
    if row is None or not can_view(user, row):
        raise AppError("NOT_FOUND", "This submission does not exist.", 404)
    return build_submission(row, datetime.now(UTC))


def validation_error(message: str) -> AppError:
    return AppError("VALIDATION_ERROR", message, 400)


def ensure_usable_code(code: str) -> None:
    """Refuse code that is too large, or that Postgres could not store."""
    if not is_usable_text(code):
        raise validation_error("Code contains an unusable character.")
    if len(code.encode("utf-8")) > CODE_MAX_BYTES:
        raise validation_error(f"Code must be at most {CODE_MAX_BYTES} bytes.")


def ensure_usable_blocks(blocks: dict[str, Any]) -> None:
    """Refuse blocks that are too large, or that Postgres could not store as JSONB.

    The server keeps Blockly's JSON opaque, but JSONB is stricter than Python's
    json module. It refuses NaN and Infinity, a NUL character and half of a
    broken Unicode pair, any of which would otherwise be a 500 error.
    """
    try:
        # ensure_ascii=False keeps broken pairs as real characters, so that
        # is_usable_text can find them. A NUL still comes out as the six
        # characters \u0000, so it needs its own search.
        text = json.dumps(blocks, allow_nan=False, ensure_ascii=False)
    except ValueError:
        raise validation_error("Blocks contain an unusable number.") from None
    if "\\u0000" in text or not is_usable_text(text):
        raise validation_error("Blocks contain an unusable character.")
    if len(text.encode("utf-8")) > BLOCKS_MAX_BYTES:
        raise validation_error(f"Blocks must be at most {BLOCKS_MAX_BYTES} bytes.")


def ensure_claimed(user: User) -> None:
    """Raise 403 FORBIDDEN for a team account that has no team row yet."""
    if user.team_id is None:
        raise AppError("FORBIDDEN", "Claim a territory before submitting.", 403)


def ensure_team_can_submit(team: Team) -> None:
    """Raise 403 unless the team is active. Only disqualified has its own code."""
    if team.status == "disqualified":
        raise AppError(
            "TEAM_DISQUALIFIED", "Disqualified teams cannot submit.", 403
        )
    if team.status != "active":
        raise AppError("FORBIDDEN", "Eliminated teams cannot submit.", 403)


def ensure_round_accepts_submissions(row: Round | None) -> Round:
    """Return the round if it exists, is open and has not reached its deadline.

    The deadline is checked as well as the status because a round stays open
    after closes_at until an organiser starts it.
    """
    if row is None:
        raise AppError("NOT_FOUND", "This round does not exist.", 404)
    if row.status != "open" or datetime.now(UTC) >= row.closes_at:
        raise AppError("ROUND_NOT_OPEN", "This round is not open for submissions.", 409)
    return row


def ensure_within_module_limit(modules: list[dict[str, Any]], round_row: Round) -> None:
    """Apply this round's max_modules, which only the database knows."""
    max_modules = round_row.config["max_modules"]
    if len(modules) > max_modules:
        raise validation_error(f"A submission can have at most {max_modules} modules.")


def replay_submission(existing: SubmissionRow, request: SubmissionCreate) -> Submission:
    """Answer a repeated Idempotency-Key: the original if the body matches.

    The stored row is the record of what was first sent, so no hash of the body
    has to be kept. Comparing dictionaries ignores key order, which JSONB does
    not preserve anyway.
    """
    same_body = (
        existing.round_id == request.round_id
        and existing.code == request.code
        and existing.blocks == request.blocks.model_dump()
    )
    if not same_body:
        raise AppError(
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with a different body.",
            422,
        )
    return build_submission(existing, datetime.now(UTC))


async def create_submission(
    db: AsyncSession,
    user: User,
    request: SubmissionCreate,
    idempotency_key: str | None,
) -> tuple[Submission, bool]:
    """Save a new version as pending. The bool is False for a repeated key.

    The team's row lock is what makes this safe under retries and double clicks.
    Two submits from one team run one at a time, so the second sees the first's
    idempotency key and version number. Different teams do not wait for each
    other. The unique constraints on the table remain as a backstop, so a
    violation here would be a bug and is left to surface as a 500.
    """
    ensure_team_account(user)
    ensure_claimed(user)
    ensure_usable_code(request.code)
    blocks = request.blocks.model_dump()
    ensure_usable_blocks(blocks)

    team = await teams_repository.get_team_for_update(db, user.team_id)
    ensure_team_can_submit(team)

    # Before the round checks on purpose. A retry of a request that succeeded
    # must get its original answer, even if the deadline passed in between.
    if idempotency_key is not None:
        existing = await submissions_repository.get_by_idempotency_key(
            db, team.id, idempotency_key
        )
        if existing is not None:
            return replay_submission(existing, request), False

    round_row = ensure_round_accepts_submissions(
        await rounds_repository.get_round_for_share(db, request.round_id)
    )
    ensure_within_module_limit(request.blocks.modules, round_row)

    version = await submissions_repository.get_highest_version(db, team.id) + 1
    row = await submissions_repository.create_submission(
        db, team.id, round_row.id, version, request.code, blocks, idempotency_key
    )
    await db.commit()
    return build_submission(row, datetime.now(UTC)), True
