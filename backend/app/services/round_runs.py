"""The background run that plays a round's matches once an organiser starts it.

POST /admin/rounds/{id}/start answers straight away with the round running, and
this file then plays every match, stores the matches and each team's score and
rank, and moves the round on to review. Like submission_checks.py it runs outside any request, so it opens its
own database sessions.

Failure is safe by design: everything the run writes is saved in one commit at
the end. A crash before that leaves no matches stored and the round still
running, so an organiser can call POST /admin/rounds/{id}/retry, and a server
restart resumes it, with nothing half-saved to clean up first.

A crash also stores a short reason in rounds.run_error, and every run clears it
as it begins. GET /admin/overview shows it as run_state and run_error, so the
console can tell "matches still playing" from "the run failed, press Retry"
without the round's status changing (docs/api.md section 7, v5.6).

ASSUMES ONE SERVER PROCESS, like submission checks (see app/main.py).
"""

import asyncio
import logging
import random
import secrets
import time
from datetime import datetime
from typing import NamedTuple

from app.core.database import SessionLocal
from app.repositories import matches as matches_repository
from app.repositories import rounds as rounds_repository
from app.repositories import standings as standings_repository
from app.repositories import submissions as submissions_repository
from app.repositories import teams as teams_repository
from app.schemas.rounds import Game
from app.services import engine_bridge, ranking

logger = logging.getLogger(__name__)

# The number of turns is drawn from this range, inclusive. Bots are never told
# the turn count, but a fixed count could still be learned and planned for, for
# example by betraying on the last turn of a Prisoner's Dilemma match.
MIN_TURNS = 150
MAX_TURNS = 250

# How long a run waits for submission checks still in progress in its round,
# and how often it looks. Checks take seconds, so the limit is only reached if
# something is badly wrong, and then the run fails and can be retried.
CHECK_WAIT_SECONDS = 600
CHECK_POLL_SECONDS = 1.0

# The ids of rounds being run right now in this process. A set in memory is
# enough because the server is one process. It is what stops two runs of the
# same round at once, for example after two quick retries.
RUNS_IN_PROGRESS: set[int] = set()

# The longest reason stored in rounds.run_error. Long enough for an exception's
# type and a line of its message, short enough to read on the console at a glance.
RUN_ERROR_MAX_LENGTH = 200


class ChecksDidNotFinish(TimeoutError):
    """The run gave up waiting for submission checks in its round.

    Its own class, rather than a plain TimeoutError, so describe_failure can name
    this case exactly without catching some other timeout by mistake.
    """


class RoundPlan(NamedTuple):
    """Everything a run needs to know about a round, read in one session.

    entrant_ids is every team active at the time, whether or not it has a bot,
    so that teams with no accepted submission still get a rank, at the bottom.
    """

    game: Game
    closes_at: datetime
    seed: int
    repetitions: int
    entrant_ids: list[int]


def new_seed() -> int:
    """Return a fresh random seed for a round.

    secrets rather than random, because the seed must not be guessable: from it
    a team could work out the number of turns. 63 bits, so it fits in a signed
    64-bit BIGINT column.
    """
    return secrets.randbits(63)


def turns_for(seed: int) -> int:
    """Pick the number of turns from the round's seed.

    A random.Random of its own, seeded with the round's seed, so the answer is
    the same on every retry, and nothing else in the server shares its stream.
    """
    return random.Random(seed).randint(MIN_TURNS, MAX_TURNS)


def is_in_progress(round_id: int) -> bool:
    return round_id in RUNS_IN_PROGRESS


async def wait_for_checks(round_id: int) -> None:
    """Return once no submission in this round is pending or running.

    Without this a team that submitted just before the start, whose check had not
    finished, would play with its older bot, as only accepted bots play. The
    window is closed by now, so no new submissions can arrive while waiting.
    """
    deadline = time.monotonic() + CHECK_WAIT_SECONDS
    while True:
        async with SessionLocal() as db:
            if not await submissions_repository.has_unfinished_in_round(db, round_id):
                return
        if time.monotonic() > deadline:
            raise ChecksDidNotFinish(f"Checks in round {round_id} did not finish in time.")
        await asyncio.sleep(CHECK_POLL_SECONDS)


async def load_plan(round_id: int) -> tuple[RoundPlan, dict[int, str]]:
    """Read the round's settings and each playing team's bot.

    The session closes on return, so no connection is held while the matches
    run, which can take minutes.

    A round that started before seeds existed gets one here, saved straight away
    so any later retry uses the same one.
    """
    async with SessionLocal() as db:
        round_row = await rounds_repository.get_by_id(db, round_id)
        if round_row.seed is None:
            round_row.seed = new_seed()
            await db.commit()
        plan = RoundPlan(
            game=round_row.game,
            closes_at=round_row.closes_at,
            seed=round_row.seed,
            repetitions=round_row.config["repetitions"],
            entrant_ids=await teams_repository.list_active_team_ids(db),
        )
        codes = await submissions_repository.get_playing_codes(
            db, round_id, plan.closes_at
        )
        # The two queries above run a moment apart, so a team whose status an
        # organiser changed in between could have a bot without being an entrant.
        # Keeping only entrants' bots makes the two lists agree, so ranking never
        # meets a team it has no place for.
        entrants = set(plan.entrant_ids)
        codes = {team_id: code for team_id, code in codes.items() if team_id in entrants}
        return plan, codes


async def save_results(
    round_id: int,
    result: engine_bridge.RoundRobinResult,
    standings: list[ranking.TeamResult],
) -> None:
    """Store every match and standing, disqualify the teams that forfeited, and
    move to review.

    All in one commit, so the round only reaches review with its full results,
    and a failure part way through saves nothing.

    The round is locked first and its status checked again. If something else
    already finished it, such as a second server process, this run saves nothing
    rather than storing the same matches twice.

    A team an organiser disqualified while the matches were playing is moved to
    the bottom here, as a disqualification in review would move it, so the cut
    never keeps a disqualified team. The round lock makes this read safe: a
    status change takes a shared lock on the round first, so it cannot land
    between this read and the commit.
    """
    async with SessionLocal() as db:
        round_row = await rounds_repository.get_round_for_update(db, round_id)
        if round_row.status != "running":
            logger.warning("Round %s is %s, not saving results", round_id, round_row.status)
            return
        await matches_repository.add_matches(
            db, round_id, [match.model_dump() for match in result.matches]
        )
        disqualified_meanwhile = await teams_repository.list_disqualified_ids(
            db, [standing.team_id for standing in standings]
        )
        standings = ranking.move_to_bottom(standings, disqualified_meanwhile)
        await standings_repository.add_standings(
            db, round_id, [standing._asdict() for standing in standings]
        )
        await teams_repository.set_status_for_teams(db, result.disqualified, "disqualified")
        round_row.status = "review"
        await db.commit()


async def play_round(round_id: int) -> None:
    """Run one round from start to finish. Raises if anything fails."""
    await wait_for_checks(round_id)
    plan, codes = await load_plan(round_id)
    # Teams with no accepted submission are absent from codes, so they play no
    # matches. rank_round still ranks them, below every team that played.
    result = await engine_bridge.run_round_robin(
        codes,
        plan.game,
        turns_for(plan.seed),
        plan.repetitions,
        plan.seed,
    )
    standings = ranking.rank_round(plan.entrant_ids, list(codes), result, plan.seed)
    await save_results(round_id, result, standings)


def describe_failure(error: Exception) -> str:
    """Turn a run's exception into the short reason organisers see.

    Only organisers see it, so naming the exception is fine and helps them tell
    the organiser on call what broke. It is cut to RUN_ERROR_MAX_LENGTH so one
    huge engine message cannot flood the console.
    """
    if isinstance(error, ChecksDidNotFinish):
        return "Bot checks did not finish in time."
    detail = type(error).__name__
    if str(error):
        detail = f"{detail}: {error}"
    reason = f"The match run crashed ({detail})"
    if len(reason) > RUN_ERROR_MAX_LENGTH:
        reason = reason[: RUN_ERROR_MAX_LENGTH - 1] + "…"
    return reason


async def mark_playing(round_id: int) -> None:
    """Clear the round's last failure, as this run is about to play it.

    Every run does this, whether started by start, retry or a resume at server
    startup, so a round that failed before a restart shows as playing again while
    the restart replays it.
    """
    async with SessionLocal() as db:
        await rounds_repository.clear_run_error(db, round_id)
        await db.commit()


async def record_failure(round_id: int, error: Exception) -> None:
    """Store why the run failed. Logs, rather than raises, a failure to store it.

    If the database itself is what failed, this cannot write either. The round
    then shows as playing, the state it was in before, and the log has the cause.
    """
    try:
        async with SessionLocal() as db:
            await rounds_repository.set_run_error_if_running(
                db, round_id, describe_failure(error)
            )
            await db.commit()
    except Exception:
        logger.exception("Could not record the failed run of round %s", round_id)


async def run_round(round_id: int) -> None:
    """Run a round in the background. Never raises an Exception.

    A background task has no caller to report to, so any failure is logged and
    stored on the round, which stays running, ready to retry. The check for a run
    in progress and the add to the set have no await between them, so no other
    task can run in between: in asyncio, tasks only switch at an await.

    The failure is stored before the round leaves RUNS_IN_PROGRESS, not after.
    retry answers 409 while the round is in the set, so no retry can clear the
    error and start a new run before this one has finished writing it. In the
    other order, a quick retry could start playing and then this late write
    would show the new run as failed.
    """
    if is_in_progress(round_id):
        logger.info("Round %s is already being run", round_id)
        return
    RUNS_IN_PROGRESS.add(round_id)
    try:
        await mark_playing(round_id)
        await play_round(round_id)
    except Exception as error:
        logger.exception("Run crashed for round %s; it stays running", round_id)
        await record_failure(round_id, error)
    finally:
        RUNS_IN_PROGRESS.discard(round_id)


async def find_running_rounds() -> list[int]:
    """Return rounds a server restart left running. Logs, rather than raises, a failure.

    As with find_unfinished_checks, a database that is down must not stop the
    server starting.
    """
    try:
        async with SessionLocal() as db:
            return await rounds_repository.list_running_ids(db)
    except Exception:
        logger.exception("Could not look for running rounds")
        return []


async def run_rounds(round_ids: list[int]) -> None:
    """Run these rounds one after another.

    In turn rather than at once, as the engine bridge only plays one round at a
    time anyway. Rounds open in order, so there should only ever be one.
    """
    for round_id in round_ids:
        await run_round(round_id)
