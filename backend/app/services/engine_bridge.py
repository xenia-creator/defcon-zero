"""The one place the backend calls the game engine.

The engine in /engine is a separate package with its own owner, so its function
names and result shapes can change. Keeping every call here means a change there
is a change to this file only. The rest of the app sees just check_submission.
"""

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.schemas.rounds import Game
from app.schemas.submissions import SubmissionCheck

# /engine sits beside /backend and is not installed as a package, so Python only
# finds it once the repository folder is on the import path. It is appended, so
# an installed copy of the engine would win if a deploy ever adds one.
sys.path.append(str(Path(__file__).resolve().parents[3]))

from engine.sandbox import test_submission  # noqa: E402

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
