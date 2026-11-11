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


# How many teams each round keeps when it is published, by round number. Every
# team ranked below goes out. The last round keeps two: its rank 1 is the winner
# of the event and its rank 2 the runner-up.
#
# These are only the starting values. Each definition below carries its round's
# as config.cut, scripts/create_rounds.py copies that into the round's cut
# column, and an event reset puts them back. After that the column is what
# publish reads, so organisers can change a cut during the event
# (PATCH /admin/rounds/{id}). It is a column rather than part of the stored game
# config because it changes during the event and the game rules do not.
TEAMS_KEPT_BY_ROUND_NUMBER = {1: 15, 2: 8, 3: 2}


# Built from the schema classes, so a missing or misspelt setting fails as soon
# as this file is imported, not when the frontend later reads the row.
ROUND_DEFINITIONS: list[RoundDefinition] = [
    RoundDefinition(
        number=1,
        game="prisoners_dilemma",
        config=RoundConfig(
            moves=["C", "D"], cut=TEAMS_KEPT_BY_ROUND_NUMBER[1], **SHARED_LIMITS
        ),
    ),
    RoundDefinition(
        number=2,
        game="theatre_of_war",
        config=TheatreOfWarConfig(
            moves=[],
            troops=100,
            regions=5,
            cut=TEAMS_KEPT_BY_ROUND_NUMBER[2],
            **SHARED_LIMITS,
        ),
    ),
    RoundDefinition(
        number=3,
        game="foreign_aid",
        config=ForeignAidConfig(
            moves=[],
            endowment=10,
            multiplier=3,
            cut=TEAMS_KEPT_BY_ROUND_NUMBER[3],
            **SHARED_LIMITS,
        ),
    ),
]


# The last round. Its cut is fixed, because its rank 1 is the winner and its
# rank 2 the runner-up, so it cannot be edited like the others.
FINAL_ROUND_NUMBER = ROUND_DEFINITIONS[-1].number
