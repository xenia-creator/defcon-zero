"""The three rounds of the event: the single list of what each one plays.

Like territories, this is fixed game data decided before the event. Unlike
territories, each round also needs a table row, because its status and times
change during the event. scripts/create_rounds.py copies this list into the
rounds table, and after that the table is what the app reads.
"""

from typing import NamedTuple

from app.schemas.rounds import (
    ForeignAidConfig,
    Game,
    RoundConfig,
    TheatreOfWarConfig,
)

# Limits shared by every game. They are written once so the rounds cannot differ
# by accident. A game that needs its own value can stop using this dictionary.
SHARED_LIMITS = {
    "max_modules": 3,
    "block_limit": 40,
    "rounds_per_match": 200,
    "repetitions": 5,
}


class RoundDefinition(NamedTuple):
    """What one round plays. Status and times are absent: they start empty."""

    number: int
    game: Game
    config: RoundConfig


# Built from the schema classes, so a missing or misspelt setting fails as soon
# as this file is imported, not when the frontend later reads the row.
ROUND_DEFINITIONS: list[RoundDefinition] = [
    RoundDefinition(
        number=1,
        game="prisoners_dilemma",
        config=RoundConfig(moves=["C", "D"], **SHARED_LIMITS),
    ),
    RoundDefinition(
        number=2,
        game="theatre_of_war",
        config=TheatreOfWarConfig(moves=[], troops=100, regions=5, **SHARED_LIMITS),
    ),
    RoundDefinition(
        number=3,
        game="foreign_aid",
        config=ForeignAidConfig(moves=[], endowment=10, multiplier=3, **SHARED_LIMITS),
    ),
]


# How many teams each round keeps when it is published, by round number. Every
# team ranked below goes out. The last round keeps two: its rank 1 is the winner
# of the event and its rank 2 the runner-up. Kept here, not in config, because
# config is sent to the frontend and this is a rule of the event, not of a game.
TEAMS_KEPT_BY_ROUND_NUMBER = {1: 15, 2: 8, 3: 2}
