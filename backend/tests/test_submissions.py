"""Tests for submitting a bot, the background check, and reading submissions back.

The test client waits for background tasks before returning, so a check has always
finished by the time client.post returns, and these tests need no polling. The
response body was built before the check ran, so it still says pending, as it
does for a real client. A real server sends the response first.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest

from app.core.database import SessionLocal
from app.main import app
from app.repositories import rounds as rounds_repository
from app.services import engine_bridge, submission_checks
from app.services.submissions import BLOCKS_MAX_BYTES, CODE_MAX_BYTES
from engine.blotto_strategies import BLOTTO_BOTS
from engine.foreign_aid_strategies import FOREIGN_AID_BOTS
from engine.strategies import BUILT_IN_BOTS
from tests.conftest import assert_error, run_sql, wait_until_a_query_is_blocked

GOOD_BOT = (
    "def strategy(my_history, opp_history):\n"
    '    return opp_history[-1] if opp_history else "C"\n'
)
BOT_WITH_SYNTAX_ERROR = "def strategy(my_history, opp_history)\n    return 'C'\n"
BOT_WITH_BAD_MOVE = "def strategy(my_history, opp_history):\n    return 'X'\n"
# The example bots from docs/api.md section 8.
THEATRE_OF_WAR_BOT = (
    "def strategy(my_history, opp_history):\n"
    "    return [20, 20, 20, 20, 20]\n"
)
FOREIGN_AID_BOT = (
    "def strategy(my_history, opp_history):\n"
    "    if len(opp_history) == len(my_history):\n"
    "        return 5\n"
    "    return opp_history[-1]\n"
)
BLOCKS = {"modules": [{"type": "workspace"}]}

ClaimedTeam = Callable[..., Awaitable[dict[str, str]]]


def body(round_id: int, code: str = GOOD_BOT, blocks: Any = None) -> dict[str, Any]:
    return {"round_id": round_id, "code": code, "blocks": blocks or BLOCKS}


def with_key(headers: dict[str, str], key: str) -> dict[str, str]:
    return {**headers, "Idempotency-Key": key}


async def submit(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    round_id: int,
    code: str = GOOD_BOT,
) -> httpx.Response:
    return await client.post(
        "/submissions", json=body(round_id, code), headers=headers
    )


async def post_raw(
    client: httpx.AsyncClient, headers: dict[str, str], content: str
) -> httpx.Response:
    """Send JSON text as written, for values a Python client would refuse to encode."""
    return await client.post(
        "/submissions",
        content=content,
        headers={**headers, "Content-Type": "application/json"},
    )


async def count_submissions() -> int:
    rows = await run_sql("SELECT count(*) FROM submissions")
    return rows[0][0]


@pytest.fixture
async def open_round_id(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> int:
    """Round 1, open for 30 minutes."""
    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/open", json={"minutes": 30}, headers=organiser
    )
    assert response.status_code == 200
    return round_ids[1]


# --- Submitting while open ---


async def test_submitting_while_open_returns_202_and_pending(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await submit(client, await claimed_team(), open_round_id)

    assert response.status_code == 202
    saved = response.json()
    assert set(saved) == {
        "id",
        "round_id",
        "version",
        "status",
        "created_at",
        "code",
        "blocks",
        "check",
        "server_time",
    }
    assert saved["status"] == "pending"
    assert saved["check"] is None
    assert saved["version"] == 1
    assert saved["round_id"] == open_round_id
    assert saved["code"] == GOOD_BOT
    assert saved["blocks"] == BLOCKS


# --- Submitting while closed ---


@pytest.mark.parametrize("status", ["waiting", "running", "review", "published"])
async def test_submitting_outside_open_is_refused(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    round_ids: dict[int, int],
    status: str,
) -> None:
    headers = await claimed_team()
    # A deadline in the future, so that only the status can be the reason.
    await run_sql(
        "UPDATE rounds SET status = :status, closes_at = now() + interval '1 hour' "
        "WHERE id = :id",
        status=status,
        id=round_ids[1],
    )

    response = await submit(client, headers, round_ids[1])

    assert_error(response, 409, "ROUND_NOT_OPEN")
    assert await count_submissions() == 0


async def test_submitting_after_the_deadline_is_refused(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    """The round is still open, because nobody has pressed start yet."""
    headers = await claimed_team()
    await run_sql("UPDATE rounds SET closes_at = now() - interval '1 second'")

    response = await submit(client, headers, open_round_id)

    assert_error(response, 409, "ROUND_NOT_OPEN")


async def test_submitting_to_a_round_that_does_not_exist(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await submit(client, await claimed_team(), open_round_id + 1000)

    assert_error(response, 404, "NOT_FOUND")


# --- Who can submit ---


async def test_submitting_needs_a_token(
    client: httpx.AsyncClient, open_round_id: int
) -> None:
    response = await client.post("/submissions", json=body(open_round_id))

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_organisers_cannot_submit(
    client: httpx.AsyncClient, organiser: dict[str, str], open_round_id: int
) -> None:
    assert_error(await submit(client, organiser, open_round_id), 403, "FORBIDDEN")


async def test_unclaimed_teams_cannot_submit(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    open_round_id: int,
) -> None:
    response = await submit(client, await log_in_new_user(), open_round_id)

    assert_error(response, 403, "FORBIDDEN")


@pytest.mark.parametrize(
    "team_status,code",
    [("eliminated", "FORBIDDEN"), ("disqualified", "TEAM_DISQUALIFIED")],
)
async def test_inactive_teams_cannot_submit(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    team_status: str,
    code: str,
) -> None:
    headers = await claimed_team()
    await run_sql("UPDATE teams SET status = :status", status=team_status)

    response = await submit(client, headers, open_round_id)

    assert_error(response, 403, code)


# --- Size limits and unusable input ---


async def test_code_at_the_size_limit_is_accepted(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    code = "#" * CODE_MAX_BYTES

    response = await submit(client, await claimed_team(), open_round_id, code)

    assert response.status_code == 202


@pytest.mark.parametrize(
    "code",
    # The second is under the limit in characters but over it in bytes.
    ["#" * (CODE_MAX_BYTES + 1), "é" * (CODE_MAX_BYTES // 2 + 1)],
    ids=["ascii", "two_byte_characters"],
)
async def test_code_over_the_size_limit_is_refused(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    code: str,
) -> None:
    response = await submit(client, await claimed_team(), open_round_id, code)

    assert_error(response, 400, "VALIDATION_ERROR")


def blocks_of_size(size: int) -> dict[str, Any]:
    """Blocks whose JSON text is exactly this many bytes."""
    overhead = len('{"modules": [{"t": ""}]}')
    return {"modules": [{"t": "x" * (size - overhead)}]}


async def test_blocks_at_the_size_limit_are_accepted(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await client.post(
        "/submissions",
        json=body(open_round_id, blocks=blocks_of_size(BLOCKS_MAX_BYTES)),
        headers=await claimed_team(),
    )

    assert response.status_code == 202


async def test_blocks_over_the_size_limit_are_refused(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await client.post(
        "/submissions",
        json=body(open_round_id, blocks=blocks_of_size(BLOCKS_MAX_BYTES + 1)),
        headers=await claimed_team(),
    )

    assert_error(response, 400, "VALIDATION_ERROR")


async def test_max_modules_comes_from_the_rounds_config(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()
    three = {"modules": [{}, {}, {}]}
    four = {"modules": [{}, {}, {}, {}]}

    allowed = await client.post(
        "/submissions", json=body(open_round_id, blocks=three), headers=headers
    )
    refused = await client.post(
        "/submissions", json=body(open_round_id, blocks=four), headers=headers
    )

    assert allowed.status_code == 202
    assert_error(refused, 400, "VALIDATION_ERROR")


@pytest.mark.parametrize(
    "template",
    [
        '{{"round_id": {id}, "code": "a\\u0000b", "blocks": {{"modules": []}}}}',
        '{{"round_id": {id}, "code": "\\ud800", "blocks": {{"modules": []}}}}',
        '{{"round_id": {id}, "code": "x", "blocks": {{"modules": [{{"t": "\\u0000"}}]}}}}',
        '{{"round_id": {id}, "code": "x", "blocks": {{"modules": [{{"t": "\\ud800"}}]}}}}',
        '{{"round_id": {id}, "code": "x", "blocks": {{"modules": [{{"n": NaN}}]}}}}',
    ],
    ids=["nul_in_code", "broken_pair_in_code", "nul_in_blocks", "broken_pair_in_blocks", "nan"],
)
async def test_values_postgres_refuses_are_a_400_not_a_crash(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    template: str,
) -> None:
    headers = await claimed_team()

    response = await post_raw(client, headers, template.format(id=open_round_id))

    assert_error(response, 400, "VALIDATION_ERROR")


async def test_round_id_too_large_for_the_database_is_a_400(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam
) -> None:
    response = await submit(client, await claimed_team(), 99_999_999_999)

    assert_error(response, 400, "VALIDATION_ERROR")


@pytest.mark.parametrize("key", ["", "k" * 256], ids=["empty", "too_long"])
async def test_idempotency_key_length_is_limited(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    key: str,
) -> None:
    headers = with_key(await claimed_team(), key)

    response = await submit(client, headers, open_round_id)

    assert_error(response, 400, "VALIDATION_ERROR")


# --- Idempotency ---


async def test_same_key_and_body_returns_the_original(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = with_key(await claimed_team(), "same-key")

    first = await submit(client, headers, open_round_id)
    repeat = await submit(client, headers, open_round_id)

    assert first.status_code == 202
    assert repeat.status_code == 200
    assert repeat.json()["id"] == first.json()["id"]
    assert await count_submissions() == 1


async def test_a_repeat_shows_the_finished_check(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = with_key(await claimed_team(), "same-key")

    await submit(client, headers, open_round_id)
    repeat = await submit(client, headers, open_round_id)

    assert repeat.json()["status"] == "accepted"


async def test_a_repeat_does_not_run_the_check_again(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked = []
    real_run_check = submission_checks.run_check

    async def counting_run_check(submission_id: int) -> None:
        checked.append(submission_id)
        await real_run_check(submission_id)

    monkeypatch.setattr(submission_checks, "run_check", counting_run_check)
    headers = with_key(await claimed_team(), "same-key")

    await submit(client, headers, open_round_id)
    await submit(client, headers, open_round_id)

    assert len(checked) == 1


@pytest.mark.parametrize(
    "change",
    [{"code": "different"}, {"blocks": {"modules": []}}, {"round_id": "other"}],
    ids=["code", "blocks", "round_id"],
)
async def test_same_key_with_a_different_body_is_refused(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    round_ids: dict[int, int],
    change: dict[str, Any],
) -> None:
    headers = with_key(await claimed_team(), "same-key")
    await submit(client, headers, open_round_id)
    different = body(open_round_id) | change
    if change.get("round_id"):
        different["round_id"] = round_ids[2]

    response = await client.post("/submissions", json=different, headers=headers)

    assert_error(response, 422, "IDEMPOTENCY_KEY_REUSED")
    assert await count_submissions() == 1


async def test_two_teams_can_use_the_same_key(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    first_team = with_key(await claimed_team(), "same-key")
    second_team = with_key(await claimed_team("team_b", "BR", "Blue Sky"), "same-key")

    first = await submit(client, first_team, open_round_id)
    second = await submit(client, second_team, open_round_id)

    assert second.status_code == 202
    assert second.json()["id"] != first.json()["id"]


async def test_a_retry_after_the_deadline_still_gets_the_original(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    open_round_id: int,
) -> None:
    """The first request saved, but its response was lost before the round closed."""
    headers = with_key(await claimed_team(), "same-key")
    first = await submit(client, headers, open_round_id)
    await client.post(f"/admin/rounds/{open_round_id}/start", headers=organiser)

    retry = await submit(client, headers, open_round_id)

    assert retry.status_code == 200
    assert retry.json()["id"] == first.json()["id"]


async def test_ten_retries_at_once_create_one_submission(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = with_key(await claimed_team(), "same-key")

    responses = await asyncio.gather(
        *(submit(client, headers, open_round_id) for _ in range(10))
    )

    assert sorted(r.status_code for r in responses) == [200] * 9 + [202]
    assert await count_submissions() == 1


# --- Version counting ---


async def test_versions_count_up_across_rounds(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    open_round_id: int,
    round_ids: dict[int, int],
) -> None:
    headers = await claimed_team()
    first = await submit(client, headers, open_round_id)
    second = await submit(client, headers, open_round_id)
    await run_sql(
        "UPDATE rounds SET status = 'published' WHERE id = :id", id=open_round_id
    )
    await client.post(
        f"/admin/rounds/{round_ids[2]}/open", json={"minutes": 30}, headers=organiser
    )

    third = await submit(client, headers, round_ids[2])

    versions = [r.json()["version"] for r in (first, second, third)]
    assert versions == [1, 2, 3]


async def test_each_team_has_its_own_version_numbers(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    first_team = await claimed_team()
    second_team = await claimed_team("team_b", "BR", "Blue Sky")
    await submit(client, first_team, open_round_id)
    await submit(client, first_team, open_round_id)

    response = await submit(client, second_team, open_round_id)

    assert response.json()["version"] == 1


async def test_a_refused_submit_does_not_use_up_a_version(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()
    await submit(client, headers, open_round_id)
    await submit(client, headers, open_round_id, "#" * (CODE_MAX_BYTES + 1))

    response = await submit(client, headers, open_round_id)

    assert response.json()["version"] == 2


async def test_ten_submits_at_once_get_different_versions(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()

    responses = await asyncio.gather(
        *(submit(client, headers, open_round_id) for _ in range(10))
    )

    assert sorted(r.json()["version"] for r in responses) == list(range(1, 11))


# --- Submitting racing an organiser's start ---


async def test_a_submit_during_a_start_waits_and_is_refused(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    """Submit arrives while a start is part-way through its transaction.

    This session stands in for the start. The submit must wait for it and then
    see running. If it read the round without the shared lock it would see open
    and be saved after the window closed.
    """
    headers = await claimed_team()

    async with SessionLocal() as start:
        row = await rounds_repository.get_round_for_update(start, open_round_id)
        waiting_submit = asyncio.create_task(submit(client, headers, open_round_id))
        await wait_until_a_query_is_blocked()
        assert not waiting_submit.done()

        row.status = "running"
        await start.commit()

    assert_error(await waiting_submit, 409, "ROUND_NOT_OPEN")
    assert await count_submissions() == 0


async def test_a_start_during_a_submit_waits_for_it(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    open_round_id: int,
) -> None:
    """The other order: a submit is in progress when the organiser presses start.

    This session stands in for the submit, holding the shared lock. The start must
    wait, so that closes_at is set after the submit's created_at and the
    submission counts as made inside the window.
    """
    async with SessionLocal() as submit_in_progress:
        await rounds_repository.get_round_for_share(submit_in_progress, open_round_id)
        waiting_start = asyncio.create_task(
            client.post(f"/admin/rounds/{open_round_id}/start", headers=organiser)
        )
        await wait_until_a_query_is_blocked()
        assert not waiting_start.done()

        await submit_in_progress.commit()

    assert (await waiting_start).status_code == 200


async def test_submits_share_the_lock_and_do_not_queue(open_round_id: int) -> None:
    """Two shared locks at once. If they queued, this would hang, not pass."""
    async with SessionLocal() as first, SessionLocal() as second:
        await rounds_repository.get_round_for_share(first, open_round_id)
        row = await asyncio.wait_for(
            rounds_repository.get_round_for_share(second, open_round_id), timeout=2
        )

    assert row.id == open_round_id


# --- The background check ---


async def stored_result(submission_id: int) -> tuple[str, dict[str, Any] | None]:
    rows = await run_sql(
        'SELECT status, "check" FROM submissions WHERE id = :id', id=submission_id
    )
    return rows[0][0], rows[0][1]


def opponents(check: dict[str, Any]) -> set[str]:
    return {result["opponent"] for result in check["test_results"]}


def result_against(check: dict[str, Any], opponent: str) -> dict[str, Any]:
    return next(r for r in check["test_results"] if r["opponent"] == opponent)


async def open_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    number: int,
) -> int:
    """Open this round, after publishing the earlier ones as the order rule needs."""
    await run_sql(
        "UPDATE rounds SET status = 'published' WHERE number < :number", number=number
    )
    response = await client.post(
        f"/admin/rounds/{round_ids[number]}/open",
        json={"minutes": 30},
        headers=organiser,
    )
    assert response.status_code == 200
    return round_ids[number]


async def test_a_good_bot_is_accepted(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await submit(client, await claimed_team(), open_round_id)

    status, check = await stored_result(response.json()["id"])
    assert status == "accepted"
    assert check["error"] is None
    assert opponents(check) == set(BUILT_IN_BOTS)
    # 50 turns of mutual cooperation at 3 points each.
    assert result_against(check, "tit_for_tat") == {
        "opponent": "tit_for_tat",
        "my_score": 150,
        "opp_score": 150,
    }


async def test_a_syntax_error_is_rejected_with_its_message(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await submit(
        client, await claimed_team(), open_round_id, BOT_WITH_SYNTAX_ERROR
    )

    status, check = await stored_result(response.json()["id"])
    assert status == "rejected"
    assert check["error"].startswith("Syntax error on line 1")
    assert check["test_results"] == []


async def test_a_bad_move_is_rejected_with_its_message(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await submit(
        client, await claimed_team(), open_round_id, BOT_WITH_BAD_MOVE
    )

    status, check = await stored_result(response.json()["id"])
    assert status == "rejected"
    assert "Invalid Prisoner's Dilemma move 'X'" in check["error"]
    # The matches did run, so their results are stored as the engine gave them.
    assert opponents(check) == set(BUILT_IN_BOTS)


async def test_a_valid_theatre_of_war_bot_is_accepted(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """This bot's move is only legal in Theatre of War, so it proves the round's
    game reached the engine."""
    headers = await claimed_team()
    round_id = await open_round(client, organiser, round_ids, 2)

    response = await submit(client, headers, round_id, THEATRE_OF_WAR_BOT)

    status, check = await stored_result(response.json()["id"])
    assert status == "accepted"
    assert check["error"] is None
    assert opponents(check) == set(BLOTTO_BOTS)
    # Identical allocations tie every region, so each side gets 0.5 for 50 turns.
    assert result_against(check, "even_split") == {
        "opponent": "even_split",
        "my_score": 25,
        "opp_score": 25,
    }


async def test_a_valid_foreign_aid_bot_is_accepted(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    headers = await claimed_team()
    round_id = await open_round(client, organiser, round_ids, 3)

    response = await submit(client, headers, round_id, FOREIGN_AID_BOT)

    status, check = await stored_result(response.json()["id"])
    assert status == "accepted"
    assert check["error"] is None
    assert opponents(check) == set(FOREIGN_AID_BOTS)
    # This opponent sends and returns nothing. On its 25 sending turns the bot sends
    # 5 and scores 5, and the opponent scores 15. On the other 25 the opponent keeps
    # its 10 and the bot scores 0. See the scoring in docs/api.md section 8.
    assert result_against(check, "always_send_0_return_0") == {
        "opponent": "always_send_0_return_0",
        "my_score": 125,
        "opp_score": 625,
    }


async def test_status_is_running_while_the_check_runs(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = []
    real_check = engine_bridge.check_submission

    async def spying_check(code: str, game: str) -> Any:
        seen.append((await run_sql("SELECT status FROM submissions"))[0][0])
        return await real_check(code, game)

    monkeypatch.setattr(engine_bridge, "check_submission", spying_check)

    await submit(client, await claimed_team(), open_round_id)

    assert seen == ["running"]


async def test_a_crash_in_the_checker_rejects_and_hides_the_details(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def crash(code: str, game: str) -> None:
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(engine_bridge, "test_submission", crash)

    response = await submit(client, await claimed_team(), open_round_id)

    status, check = await stored_result(response.json()["id"])
    assert status == "rejected"
    assert check == {"error": submission_checks.CRASH_ERROR, "test_results": []}


# --- Resuming checks after a restart ---


async def interrupt(submission_id: int, status: str) -> None:
    """Put a row back as a restart would have left it."""
    await run_sql(
        'UPDATE submissions SET status = :status, "check" = NULL WHERE id = :id',
        status=status,
        id=submission_id,
    )


async def test_unfinished_checks_are_run_again(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()
    finished = (await submit(client, headers, open_round_id)).json()["id"]
    was_pending = (await submit(client, headers, open_round_id)).json()["id"]
    was_running = (
        await submit(client, headers, open_round_id, BOT_WITH_SYNTAX_ERROR)
    ).json()["id"]
    await interrupt(was_pending, "pending")
    await interrupt(was_running, "running")

    found = await submission_checks.find_unfinished_checks()
    await submission_checks.run_checks(found)

    assert found == [was_pending, was_running]
    assert (await stored_result(finished))[0] == "accepted"
    assert (await stored_result(was_pending))[0] == "accepted"
    assert (await stored_result(was_running))[0] == "rejected"


async def test_server_startup_resumes_unfinished_checks(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    """Runs the real startup code. The test client alone does not trigger it."""
    response = await submit(client, await claimed_team(), open_round_id)
    submission_id = response.json()["id"]
    await interrupt(submission_id, "running")

    async with app.router.lifespan_context(app):
        for _ in range(500):
            if (await stored_result(submission_id))[0] == "accepted":
                break
            await asyncio.sleep(0.01)

    assert (await stored_result(submission_id))[0] == "accepted"


# --- Reading submissions, and team isolation ---


async def test_list_shows_own_versions_newest_first_without_code(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()
    older = await submit(client, headers, open_round_id)
    newer = await submit(client, headers, open_round_id, BOT_WITH_SYNTAX_ERROR)

    response = await client.get(
        "/submissions", params={"round_id": open_round_id}, headers=headers
    )

    assert response.status_code == 200
    assert set(response.json()) == {"submissions", "server_time"}
    listed = response.json()["submissions"]
    assert [item["id"] for item in listed] == [newer.json()["id"], older.json()["id"]]
    assert [item["status"] for item in listed] == ["rejected", "accepted"]
    assert all(
        set(item) == {"id", "version", "status", "created_at"} for item in listed
    )


async def test_list_only_covers_the_requested_round(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    open_round_id: int,
    round_ids: dict[int, int],
) -> None:
    headers = await claimed_team()
    await submit(client, headers, open_round_id)

    response = await client.get(
        "/submissions", params={"round_id": round_ids[2]}, headers=headers
    )

    assert response.json()["submissions"] == []


async def test_list_never_shows_another_teams_submissions(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    first_team = await claimed_team()
    second_team = await claimed_team("team_b", "BR", "Blue Sky")
    await submit(client, first_team, open_round_id)

    response = await client.get(
        "/submissions", params={"round_id": open_round_id}, headers=second_team
    )

    assert response.json()["submissions"] == []


async def test_list_is_empty_for_organisers(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    open_round_id: int,
) -> None:
    await submit(client, await claimed_team(), open_round_id)

    response = await client.get(
        "/submissions", params={"round_id": open_round_id}, headers=organiser
    )

    assert response.status_code == 200
    assert response.json()["submissions"] == []


async def test_list_is_empty_for_an_unknown_round(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    response = await client.get(
        "/submissions",
        params={"round_id": open_round_id + 1000},
        headers=await claimed_team(),
    )

    assert response.status_code == 200
    assert response.json()["submissions"] == []


@pytest.mark.parametrize("query", ["", "?round_id=abc", "?round_id=0", "?round_id=99999999999"])
async def test_list_refuses_a_bad_round_id(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, query: str
) -> None:
    response = await client.get(f"/submissions{query}", headers=await claimed_team())

    assert_error(response, 400, "VALIDATION_ERROR")


async def test_reading_submissions_needs_a_token(client: httpx.AsyncClient) -> None:
    assert_error(
        await client.get("/submissions", params={"round_id": 1}),
        401,
        "UNAUTHENTICATED",
    )
    assert_error(await client.get("/submissions/1"), 401, "UNAUTHENTICATED")


async def test_a_team_reads_its_own_submission_in_full(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    headers = await claimed_team()
    saved = (await submit(client, headers, open_round_id)).json()

    response = await client.get(f"/submissions/{saved['id']}", headers=headers)

    assert response.status_code == 200
    full = response.json()
    assert full["status"] == "accepted"
    assert full["code"] == GOOD_BOT
    assert full["blocks"] == BLOCKS
    assert full["check"]["error"] is None
    assert opponents(full["check"]) == set(BUILT_IN_BOTS)
    assert "server_time" in full


async def test_another_teams_submission_looks_like_it_does_not_exist(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, open_round_id: int
) -> None:
    owner = await claimed_team()
    other_team = await claimed_team("team_b", "BR", "Blue Sky")
    saved = (await submit(client, owner, open_round_id)).json()

    theirs = await client.get(f"/submissions/{saved['id']}", headers=other_team)
    missing = await client.get(f"/submissions/{saved['id'] + 1000}", headers=other_team)

    assert_error(theirs, 404, "NOT_FOUND")
    # Identical, or the difference would reveal that the first id exists.
    assert theirs.json() == missing.json()


async def test_an_unclaimed_team_cannot_read_a_submission(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    open_round_id: int,
) -> None:
    saved = (await submit(client, await claimed_team(), open_round_id)).json()

    response = await client.get(
        f"/submissions/{saved['id']}", headers=await log_in_new_user("unclaimed")
    )

    assert_error(response, 404, "NOT_FOUND")


async def test_organisers_can_read_any_submission(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    open_round_id: int,
) -> None:
    saved = (await submit(client, await claimed_team(), open_round_id)).json()

    response = await client.get(f"/submissions/{saved['id']}", headers=organiser)

    assert response.status_code == 200
    assert response.json()["code"] == GOOD_BOT


@pytest.mark.parametrize("bad_id", [0, -1, 2_147_483_648, 99_999_999_999, -99_999_999_999])
async def test_submission_ids_out_of_range_are_a_404_not_a_crash(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam, bad_id: int
) -> None:
    response = await client.get(f"/submissions/{bad_id}", headers=await claimed_team())

    assert_error(response, 404, "NOT_FOUND")


async def test_a_submission_id_that_is_not_a_number_is_a_400(
    client: httpx.AsyncClient, claimed_team: ClaimedTeam
) -> None:
    response = await client.get("/submissions/abc", headers=await claimed_team())

    assert_error(response, 400, "VALIDATION_ERROR")
