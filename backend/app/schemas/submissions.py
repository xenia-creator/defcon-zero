"""Schemas for bot submissions (docs/api.md section 5)."""

from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field

SubmissionStatus = Literal["pending", "running", "accepted", "rejected"]


class Blocks(BaseModel):
    """Blockly workspace JSON, stored because Python cannot be turned back into blocks."""

    # dict[str, Any]: Blockly owns this format, so the server keeps it opaque.
    # max_length=3 gives the contract's 400 for "more than 3 modules". The real
    # limit is per round (config.max_modules), which a schema cannot read, so
    # the service layer must check that once rounds live in the database.
    modules: list[dict[str, Any]] = Field(max_length=3)


class SampleBotResult(BaseModel):
    """One test match against a sample bot. `opponent` is its engine identifier."""

    opponent: str
    my_score: int
    opp_score: int


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
    round_id: int
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
