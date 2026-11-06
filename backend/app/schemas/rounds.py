"""Schemas for rounds and the organiser actions on them (docs/api.md section 4)."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

Game = Literal["prisoners_dilemma", "blotto", "trust"]
RoundStatus = Literal["waiting", "open", "running", "review", "published"]


class RoundConfig(BaseModel):
    """Per-round rules. The editor reads its limits from here, not from constants."""

    moves: list[str]
    max_modules: int
    block_limit: int
    rounds_per_match: int
    repetitions: int


class Round(BaseModel):
    id: int
    # `number` is display only (DEFCON level). Clients pick the game from `game`.
    number: int
    game: Game
    status: RoundStatus
    # AwareDatetime requires a timezone. A plain datetime would allow a value
    # with no offset, and the contract's timers depend on times being absolute.
    # Both are nullable because a waiting round may not have its times yet.
    opens_at: AwareDatetime | None
    closes_at: AwareDatetime | None
    config: RoundConfig
    # Clients compute timers as closes_at - server_time, so a wrong client
    # clock cannot change how long a team thinks it has left.
    server_time: AwareDatetime


class RoundsResponse(BaseModel):
    rounds: list[Round]
    server_time: AwareDatetime


class OpenRoundRequest(BaseModel):
    closes_at: AwareDatetime


class ExtendRoundRequest(BaseModel):
    # gt=0: zero or negative minutes would not be an extension. It fails here
    # as a 400 VALIDATION_ERROR before any later code has to think about it.
    minutes: int = Field(gt=0)
