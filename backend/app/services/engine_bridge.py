"""The one place the backend calls the game engine.

The engine in /engine is a separate package with its own owner, so its function
names and result shapes can change. Keeping every call here means a change there
is a change to this file only. The rest of the app sees just check_submission.

TEMPORARY: the engine's next version has test_submission(code, game) returning
{error, test_results}, with scores, for all three games. This file is written
against that shape, and adapt_old_result converts today's {ok, errors} into it.
When that version lands, delete SUPPORTED_GAMES, NOT_AVAILABLE_ERROR and
adapt_old_result, and pass game to test_submission.
"""

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from app.schemas.rounds import Game
from app.schemas.submissions import SubmissionCheck

# /engine sits beside /backend and is not installed as a package, so Python only
# finds it once the repository folder is on the import path. It is appended, so
# an installed copy of the engine would win if a deploy ever adds one.
sys.path.append(str(Path(__file__).resolve().parents[3]))

from engine.sandbox import test_submission  # noqa: E402

SUPPORTED_GAMES: set[Game] = {"prisoners_dilemma"}
NOT_AVAILABLE_ERROR = "not available yet"

# A worker thread, because the check takes seconds of blocking work and calling it
# directly would freeze the server for every team. This is a separate pool, not
# asyncio.to_thread, because logins use that default pool for password hashing,
# and a rush of submissions must not make logins wait. The small size also limits
# load, as each running check starts up to 3 worker processes of its own. Checks
# beyond this number wait their turn.
CHECK_THREADS = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bot-check")


def adapt_old_result(result: dict[str, Any]) -> SubmissionCheck:
    """Convert today's {ok, errors} into the {error, test_results} shape.

    The old result has no scores, so test_results stays empty until the new
    engine version provides them.
    """
    error = None if result["ok"] else "\n".join(result["errors"])
    return SubmissionCheck(error=error, test_results=[])


async def check_submission(code: str, game: Game) -> SubmissionCheck:
    """Check a bot in the engine's sandbox. An error means it should be rejected."""
    if game not in SUPPORTED_GAMES:
        return SubmissionCheck(error=NOT_AVAILABLE_ERROR, test_results=[])
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(CHECK_THREADS, test_submission, code)
    return adapt_old_result(result)
