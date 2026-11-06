"""Schemas for bot submissions (docs/api.md section 5)."""

from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field

from app.schemas.ids import MAX_DATABASE_ID

SubmissionStatus = Literal["pending", "running", "accepted", "rejected"]


class Blocks(BaseModel):
    """Blockly workspace JSON, stored because Python cannot be turned back into blocks."""

    # dict[str, Any]: Blockly owns this format, so the server keeps it opaque.
    # The limit on modules is per round (config.max_modules). A schema cannot
    # read the database, so services/submissions.py checks it.
    modules: list[dict[str, Any]]


class SampleBotResult(BaseModel):
    """One test match against a sample bot. `opponent` is its engine identifier."""

    opponent: str
    # Floats because Theatre of War gives half points.
    my_score: float
    opp_score: float


class SubmissionCheck(BaseModel):
    error: str | None
    test_results: list[SampleBotResult]


class Submission(BaseModel):
    id: int
    round_id: int
    version: int
    status: SubmissionStatus
    created_at: AwareDatetime
    code: str
    blocks: Blocks
    # Null while the background check has not finished.
    check: SubmissionCheck | None
    server_time: AwareDatetime


class SubmissionCreate(BaseModel):
    round_id: int = Field(ge=1, le=MAX_DATABASE_ID)
    code: str
    blocks: Blocks


class SubmissionSummary(BaseModel):
    """Version history row. `code` and `blocks` are left out to keep the list light."""

    id: int
    version: int
    status: SubmissionStatus
    created_at: AwareDatetime


class SubmissionsResponse(BaseModel):
    submissions: list[SubmissionSummary]
    server_time: AwareDatetime
