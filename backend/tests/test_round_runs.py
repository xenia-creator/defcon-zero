"""Tests for running a round: from POST /admin/rounds/{id}/start to review.

These play real matches through the engine, with a few teams each so they stay
quick. The test client waits for background tasks, so the run has finished by
the time the start request returns, and no polling is needed.
"""

import asyncio

import httpx
import pytest

from app.main import app
from app.services import engine_bridge, round_runs
from tests.conftest import assert_error, run_sql
from tests.tournament_helpers import (
    ALWAYS_BETRAY,
    ALWAYS_COOPERATE,
    BAD_SYNTAX,
    TIME_BOMB,
    TIT_FOR_TAT,
    ClaimedTeam,
    TeamLogin,
    claim_teams,
    open_round,
    round_ranks,
    round_status,
    start_round,
    stored_matches,
    submit,
    team_statuses,
)

REPETITIONS = 5  # From SHARED_LIMITS in app/core/rounds.py.


async def round_with_bots(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_id: int,
    bots: list[str | None],
) -> list[TeamLogin]:
    """Open a round, claim one team per bot and submit each bot. None submits nothing."""
    teams = await claim_teams(client, claimed_team, len(bots))
    await open_round(client, organiser, round_id)
    for team, bot in zip(teams, bots):
        if bot is not None:
            await submit(client, team.headers, round_id, bot)
    return teams


async def round_seed(round_id: int) -> int | None:
    rows = await run_sql("SELECT seed FROM rounds WHERE id = :id", id=round_id)
    return rows[0][0]


# --- A full round, start to review ---


async def test_start_plays_every_pair_and_moves_the_round_to_review(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    teams = await round_with_bots(
        client, organiser, claimed_team, round_ids[1],
        [ALWAYS_COOPERATE, TIT_FOR_TAT, ALWAYS_BETRAY],
    )

    response = await start_round(client, organiser, round_ids[1])

    # The response is built before the run, so it says running, as a real
    # client sees. The round has moved on by the time the test continues.
    assert response.json()["status"] == "running"
    assert await round_status(round_ids[1]) == "review"
    matches = await stored_matches(round_ids[1])
    # 3 pairs, each played once per repetition, and no team plays itself.
    assert len(matches) == 3 * REPETITIONS
    assert all(m.team_a_id != m.team_b_id for m in matches)
    assert sorted({m.repetition for m in matches}) == list(range(REPETITIONS))
    assert all(m.counted for m in matches)
    # Every entrant has a standing, ranked 1 to 3.
    assert sorted((await round_ranks(round_ids[1])).values()) == [1, 2, 3]
    team_ids = {team.id for team in teams}
    assert {m.team_a_id for m in matches} | {m.team_b_id for m in matches} == team_ids


async def test_turns_come_from_the_seed_and_stay_secret(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [ALWAYS_COOPERATE, ALWAYS_COOPERATE]
    )

    response = await start_round(client, organiser, round_ids[1])

    seed = await round_seed(round_ids[1])
    assert seed is not None
    # The seed never reaches a response, or a team could work out the last turn.
    assert "seed" not in response.json()
    assert "seed" not in (await client.get("/rounds/current", headers=organiser)).json()
    # Two cooperators score 3 each per turn, so each score is 3 times the turns.
    turns = round_runs.turns_for(seed)
    assert 150 <= turns <= 250
    assert {m.score_a for m in await stored_matches(round_ids[1])} == {3.0 * turns}


def test_turns_for_stays_in_range_and_repeats_for_the_same_seed() -> None:
    turns = [round_runs.turns_for(seed) for seed in range(2000)]

    assert min(turns) >= 150 and max(turns) <= 250
    # Not one fixed number, so it cannot be learned and planned for.
    assert len(set(turns)) > 50
    assert round_runs.turns_for(12345) == round_runs.turns_for(12345)


# --- Disqualified bots ---


async def test_a_bot_that_fails_in_the_round_is_disqualified_and_its_matches_do_not_count(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    good, also_good, bomb = await round_with_bots(
        client, organiser, claimed_team, round_ids[1],
        [TIT_FOR_TAT, ALWAYS_BETRAY, TIME_BOMB],
    )

    await start_round(client, organiser, round_ids[1])

    statuses = await team_statuses()
    assert statuses[bomb.id] == "disqualified"
    assert statuses[good.id] == statuses[also_good.id] == "active"
    matches = await stored_matches(round_ids[1])
    # Every match is stored, the forfeits too, but only the ones without the
    # failed bot count.
    assert len(matches) == 3 * REPETITIONS
    for m in matches:
        assert m.counted == (bomb.id not in (m.team_a_id, m.team_b_id))
    ranks = await round_ranks(round_ids[1])
    assert ranks[bomb.id] == 3
    scores = dict(await run_sql(
        "SELECT team_id, score FROM standings WHERE round_id = :id", id=round_ids[1]
    ))
    assert scores[bomb.id] == 0.0


async def test_disqualified_bots_rank_below_teams_with_no_submission(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    good, bomb, absent = await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, TIME_BOMB, None]
    )

    await start_round(client, organiser, round_ids[1])

    ranks = await round_ranks(round_ids[1])
    assert [ranks[good.id], ranks[absent.id], ranks[bomb.id]] == [1, 2, 3]


# --- Teams with no submission ---


async def test_a_team_with_no_submission_plays_nothing_and_ranks_last(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    first, second, absent = await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [ALWAYS_BETRAY, TIT_FOR_TAT, None]
    )

    await start_round(client, organiser, round_ids[1])

    matches = await stored_matches(round_ids[1])
    assert len(matches) == 1 * REPETITIONS
    assert all(absent.id not in (m.team_a_id, m.team_b_id) for m in matches)
    assert (await round_ranks(round_ids[1]))[absent.id] == 3
    # Not playing is not an offence: the team stays active.
    assert (await team_statuses())[absent.id] == "active"


async def test_a_team_whose_only_submission_was_rejected_does_not_play(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    _, _, rejected = await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, ALWAYS_BETRAY, BAD_SYNTAX]
    )

    await start_round(client, organiser, round_ids[1])

    matches = await stored_matches(round_ids[1])
    assert all(rejected.id not in (m.team_a_id, m.team_b_id) for m in matches)
    assert (await round_ranks(round_ids[1]))[rejected.id] == 3


async def test_a_round_with_no_submissions_still_reaches_review(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    await round_with_bots(client, organiser, claimed_team, round_ids[1], [None, None])

    await start_round(client, organiser, round_ids[1])

    assert await round_status(round_ids[1]) == "review"
    assert await stored_matches(round_ids[1]) == []
    assert sorted((await round_ranks(round_ids[1])).values()) == [1, 2]


# --- Which bot plays ---


async def test_the_latest_accepted_submission_plays(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    changer, cooperator = await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [ALWAYS_COOPERATE, ALWAYS_COOPERATE]
    )
    # Version 2 betrays, and version 3 is rejected, so version 2 plays.
    await submit(client, changer.headers, round_ids[1], ALWAYS_BETRAY)
    await submit(client, changer.headers, round_ids[1], BAD_SYNTAX)

    await start_round(client, organiser, round_ids[1])

    turns = round_runs.turns_for(await round_seed(round_ids[1]))
    for m in await stored_matches(round_ids[1]):
        scores = {m.team_a_id: m.score_a, m.team_b_id: m.score_b}
        # A betrayer against a cooperator scores 5 a turn, the cooperator 0.
        assert scores == {changer.id: 5.0 * turns, cooperator.id: 0.0}


async def test_eliminated_and_disqualified_teams_do_not_play(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
) -> None:
    playing, other, eliminated, disqualified = await round_with_bots(
        client, organiser, claimed_team, round_ids[1],
        [TIT_FOR_TAT, TIT_FOR_TAT, TIT_FOR_TAT, TIT_FOR_TAT],
    )
    await run_sql("UPDATE teams SET status = 'eliminated' WHERE id = :id", id=eliminated.id)
    await run_sql("UPDATE teams SET status = 'disqualified' WHERE id = :id", id=disqualified.id)

    await start_round(client, organiser, round_ids[1])

    played = {m.team_a_id for m in await stored_matches(round_ids[1])} | {
        m.team_b_id for m in await stored_matches(round_ids[1])
    }
    assert played == {playing.id, other.id}
    # Only teams active at the start are entrants, so the others get no row.
    assert set(await round_ranks(round_ids[1])) == {playing.id, other.id}


# --- When the run fails ---


async def failing_engine(*args: object, **kwargs: object) -> None:
    raise RuntimeError("engine down")


async def test_a_crashed_run_leaves_the_round_running_and_saves_nothing(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, ALWAYS_BETRAY]
    )
    monkeypatch.setattr(engine_bridge, "run_round_robin", failing_engine)

    await start_round(client, organiser, round_ids[1])

    assert await round_status(round_ids[1]) == "running"
    assert await stored_matches(round_ids[1]) == []
    assert await round_ranks(round_ids[1]) == {}
    # The seed is kept, so a retry plays the same matches.
    assert await round_seed(round_ids[1]) is not None


async def test_retry_after_a_crash_finishes_the_round_with_the_same_seed(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, ALWAYS_BETRAY]
    )
    monkeypatch.setattr(engine_bridge, "run_round_robin", failing_engine)
    await start_round(client, organiser, round_ids[1])
    seed = await round_seed(round_ids[1])
    monkeypatch.undo()

    response = await client.post(f"/admin/rounds/{round_ids[1]}/retry", headers=organiser)

    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert await round_status(round_ids[1]) == "review"
    assert await round_seed(round_ids[1]) == seed
    assert len(await stored_matches(round_ids[1])) == 1 * REPETITIONS


@pytest.mark.parametrize("status", ["waiting", "open", "review", "published"])
async def test_retry_needs_a_running_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await run_sql("UPDATE rounds SET status = :s WHERE id = :id", s=status, id=round_ids[1])

    response = await client.post(f"/admin/rounds/{round_ids[1]}/retry", headers=organiser)

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


async def test_retry_while_the_matches_are_playing_is_409(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await run_sql("UPDATE rounds SET status = 'running' WHERE id = :id", id=round_ids[1])
    # Stands in for a run in progress in this process.
    monkeypatch.setattr(round_runs, "RUNS_IN_PROGRESS", {round_ids[1]})

    response = await client.post(f"/admin/rounds/{round_ids[1]}/retry", headers=organiser)

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


async def test_a_second_run_of_the_same_round_does_nothing(
    round_ids: dict[int, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The guard in run_round, for two retries that both passed the 409 check."""
    calls = []

    async def counting_play_round(round_id: int) -> None:
        calls.append(round_id)
        await asyncio.sleep(0.05)

    monkeypatch.setattr(round_runs, "play_round", counting_play_round)

    await asyncio.gather(round_runs.run_round(round_ids[1]), round_runs.run_round(round_ids[1]))

    assert calls == [round_ids[1]]
    assert round_runs.RUNS_IN_PROGRESS == set()


# --- Waiting for checks, and resuming ---


async def test_the_run_waits_for_checks_still_in_progress(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bot submitted just before the start must play once its check passes."""
    early, late = await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, None]
    )
    # The late team's submission is still being checked when the round starts.
    await run_sql(
        "INSERT INTO submissions (team_id, round_id, version, status, code, blocks) "
        "VALUES (:team, :round, 1, 'running', :code, '{}'::jsonb)",
        team=late.id, round=round_ids[1], code=ALWAYS_BETRAY,
    )
    await run_sql(
        "UPDATE rounds SET status = 'running', closes_at = now() + interval '1 second', "
        "seed = 99 WHERE id = :id",
        id=round_ids[1],
    )
    monkeypatch.setattr(round_runs, "CHECK_POLL_SECONDS", 0.05)

    run = asyncio.create_task(round_runs.run_round(round_ids[1]))
    await asyncio.sleep(0.3)
    assert not run.done()
    await run_sql("UPDATE submissions SET status = 'accepted' WHERE team_id = :id", id=late.id)
    await asyncio.wait_for(run, timeout=60)

    assert await round_status(round_ids[1]) == "review"
    played = {m.team_a_id for m in await stored_matches(round_ids[1])}
    played |= {m.team_b_id for m in await stored_matches(round_ids[1])}
    assert played == {early.id, late.id}


async def test_server_startup_resumes_a_round_left_running(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A restart mid-run leaves the round running, as nothing was saved."""
    await round_with_bots(
        client, organiser, claimed_team, round_ids[1], [TIT_FOR_TAT, ALWAYS_BETRAY]
    )
    monkeypatch.setattr(engine_bridge, "run_round_robin", failing_engine)
    await start_round(client, organiser, round_ids[1])
    monkeypatch.undo()
    assert await round_status(round_ids[1]) == "running"

    # Runs the app's real startup code, as uvicorn does when the server starts.
    async with app.router.lifespan_context(app):
        for _ in range(600):
            if await round_status(round_ids[1]) == "review":
                break
            await asyncio.sleep(0.05)

    assert await round_status(round_ids[1]) == "review"
    assert len(await stored_matches(round_ids[1])) == 1 * REPETITIONS
