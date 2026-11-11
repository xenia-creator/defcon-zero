"""Schemas for rounds and the organiser actions on them (docs/api.md section 4)."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

Game = Literal["prisoners_dilemma", "theatre_of_war", "foreign_aid"]
RoundStatus = Literal["waiting", "open", "running", "review", "published"]


class RoundConfig(BaseModel):
    """Per-round rules. The editor reads its limits from here, not from constants.

    This is the whole config for prisoners_dilemma. The two games with extra
    settings extend it below.
    """

    # ["C", "D"] for prisoners_dilemma. Empty for the other games, because their
    # moves are numbers checked by rule, not a fixed list of choices.
    moves: list[str]
    max_modules: int
    block_limit: int
    rounds_per_match: int
    repetitions: int
    # How many teams the round keeps when it is published. Stored in its own
    # column, not in the config JSON, and added here when the response is built.
    # Every game has one, so it lives on the shared class.
    cut: int


class TheatreOfWarConfig(RoundConfig):
    troops: int
    regions: int


class ForeignAidConfig(RoundConfig):
    endowment: int
    multiplier: int


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
    # A union rather than one class with optional fields, so a game's response
    # leaves out the other games' keys instead of sending them as null. Pydantic
    # picks the member that matches the most keys, so a dict with troops becomes
    # TheatreOfWarConfig even though it would also fit plain RoundConfig.
    config: TheatreOfWarConfig | ForeignAidConfig | RoundConfig
    # Clients compute timers as closes_at - server_time, so a wrong client
    # clock cannot change how long a team thinks it has left.
    server_time: AwareDatetime


class RoundsResponse(BaseModel):
    rounds: list[Round]
    server_time: AwareDatetime


# Outside this range fails as a 400 VALIDATION_ERROR before any later code has
# to think about it. The upper limit stops a typo setting a deadline days away.
MIN_WINDOW_MINUTES = 1
MAX_WINDOW_MINUTES = 240


class OpenRoundRequest(BaseModel):
    # Minutes rather than a time, so the deadline comes from the server's clock
    # and a wrong clock on the organiser's laptop cannot change it.
    minutes: int = Field(ge=MIN_WINDOW_MINUTES, le=MAX_WINDOW_MINUTES)


class ExtendRoundRequest(BaseModel):
    minutes: int = Field(ge=MIN_WINDOW_MINUTES, le=MAX_WINDOW_MINUTES)


class SetTimeRequest(BaseModel):
    # Minutes from now, not a time, for the same reason as open: the deadline
    # comes from the server's clock, never the organiser's laptop.
    minutes: int = Field(ge=MIN_WINDOW_MINUTES, le=MAX_WINDOW_MINUTES)


class UpdateRoundRequest(BaseModel):
    """The body of PATCH /admin/rounds/{id}. The cut is the only editable setting.

    ge=1 turns 0 and negatives into a 400 VALIDATION_ERROR here, as minutes does.
    The limits that depend on the other rounds' cuts need the database, so the
    service checks those.
    """

    cut: int = Field(ge=1)
