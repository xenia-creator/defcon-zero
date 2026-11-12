"""The one place the backend calls the game engine.

The engine in /engine is a separate package with its own owner, so its function
names and result shapes can change. Keeping every call here means a change there
is a change to this file only. The rest of the app sees just check_submission,
for one bot against the sample bots, run_round_robin, for a round's matches, and
order_tied_teams, for ranking teams on the same score.
"""

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rounds import Game
from app.schemas.submissions import SubmissionCheck

# /engine sits beside /backend and is not installed as a package, so Python only
# finds it once the repository folder is on the import path. It is appended, so
# an installed copy of the engine would win if a deploy ever adds one.
sys.path.append(str(Path(__file__).resolve().parents[3]))

from engine.sandbox import run_safe_round_robin, test_submission  # noqa: E402
from engine.tournament import break_tie  # noqa: E402

# A worker thread, because the check takes seconds of blocking work and calling it
# directly would freeze the server for every team. This is a separate pool, not
# asyncio.to_thread, because logins use that default pool for password hashing,
# and a rush of submissions must not make logins wait. The small size also limits
# load, as each running check starts a worker process per sample bot, up to one
# per CPU core. Checks beyond this number wait their turn.
CHECK_THREADS = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bot-check")


async def check_submission(code: str, game: Game) -> SubmissionCheck:
    """Check a bot in the engine's sandbox. An error means it should be rejected.

    Our game keys are the engine's game keys, so game passes straight through.
    turns is left to the engine's default: this is a quick test against the sample
    bots, not the real match, and a longer one would make teams wait for no gain.

    The engine's result already has the shape of SubmissionCheck. Validating it
    here means a future change to that shape fails loudly, as a crash the caller
    handles, rather than being saved as a wrong result.
    """
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(CHECK_THREADS, test_submission, code, game)
    return SubmissionCheck.model_validate(result)


# One thread, so only one round runs at a time. A round already uses every CPU
# core, as the engine starts a worker process per core, so a second round in
# parallel would only slow both down. It is separate from CHECK_THREADS so a long
# round never makes a team's submission check wait for a free thread.
ROUND_THREADS = ThreadPoolExecutor(max_workers=1, thread_name_prefix="round-run")


class MatchRecord(BaseModel):
    """One match from the engine, in the backend's names.

    validation_alias reads the engine's key while the backend uses its own name,
    so the rest of the app never sees player_a or player_b. The engine's records
    carry more keys than these, such as the forfeit reason, and pydantic ignores
    the ones not listed.

    populate_by_name also accepts our own names, so a record can be rebuilt from
    a stored matches row when a round is re-ranked.
    """

    model_config = ConfigDict(populate_by_name=True)

    team_a_id: int = Field(validation_alias="player_a")
    team_b_id: int = Field(validation_alias="player_b")
    repetition: int
    score_a: float
    score_b: float
    counted: bool


class RoundRobinResult(BaseModel):
    """What the backend keeps from a round robin: every match, and who forfeited.

    The engine's leaderboard is left out on purpose. Step 3 ranks teams from the
    stored matches, so the totals come from one place.
    """

    matches: list[MatchRecord]
    disqualified: list[int]


async def run_round_robin(
    codes: dict[int, str], game: Game, turns: int, repetitions: int, seed: int
) -> RoundRobinResult:
    """Play every team against every other, in the engine's sandbox.

    codes maps team id to bot code. The engine names each participant by its key,
    so team ids come back in the results and need no mapping table. Only the bots
    passed in play: the engine never adds built-in bots to a round robin.

    include_self_play is False because a team playing itself would earn points no
    opponent gave it. Noise uses the engine's game-aware default: 5% for
    Prisoner's Dilemma and none for Theatre of War or Foreign Aid.

    The result is validated here, as in check_submission, so a change to the
    engine's shape fails loudly instead of being saved as wrong matches.
    """
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        ROUND_THREADS,
        # run_in_executor only passes positional arguments, so the keyword ones
        # are written out in a lambda. They are named because the engine has a
        # noise argument between repetitions and seed.
        lambda: run_safe_round_robin(
            codes,
            game,
            turns,
            repetitions=repetitions,
            seed=seed,
            include_self_play=False,
        ),
    )
    return RoundRobinResult.model_validate(result)


def order_tied_teams(
    team_ids: list[int], head_to_head: list[MatchRecord], seed: int
) -> list[int]:
    """Order teams tied on score: most head-to-head wins first, then by seed.

    The engine counts a head-to-head win for each match one team scored more in,
    among the tied teams only, and ignores draws. Teams still level are shuffled
    with a random generator of its own, seeded with seed, so the same round always
    gives the same order. Plain and fast, so it runs in place, not in a thread.

    The engine reads (team_a, team_b, score_a, score_b) tuples, built from our
    records here so the rest of the app keeps its own names.
    """
    records = [(m.team_a_id, m.team_b_id, m.score_a, m.score_b) for m in head_to_head]
    return break_tie(team_ids, records, seed=seed)
