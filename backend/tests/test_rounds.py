"""Tests for rounds: reading them, setting them up, and the organiser transitions."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

import httpx
import pytest

from app.core.database import SessionLocal
from app.repositories import rounds as rounds_repository
from app.services.rounds import create_missing_rounds
from tests.conftest import (
    assert_error,
    bearer,
    run_sql,
    wait_until_a_query_is_blocked,
)

SHARED_CONFIG_KEYS = {
    "moves",
    "max_modules",
    "block_limit",
    "rounds_per_match",
    "repetitions",
}
ALL_ROUND_STATUSES = ["waiting", "open", "running", "review", "published"]


async def set_status(round_id: int, status: str) -> None:
    await run_sql(
        "UPDATE rounds SET status = :status WHERE id = :id", status=status, id=round_id
    )


async def open_round(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    round_id: int,
    minutes: int = 30,
) -> httpx.Response:
    return await client.post(
        f"/admin/rounds/{round_id}/open", json={"minutes": minutes}, headers=headers
    )


def parse(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)


# --- Creating the rounds ---


async def test_creating_rounds_twice_leaves_existing_rounds_alone(
    round_ids: dict[int, int],
) -> None:
    # The fixture has already run it once. An open round must survive a re-run,
    # or running the script mid-event would reset the event.
    await set_status(round_ids[1], "open")

    async with SessionLocal() as db:
        results = await create_missing_rounds(db)
        await db.commit()
        rows = await rounds_repository.list_rounds(db)

    assert [created for _, created in results] == [False, False, False]
    assert [row.status for row in rows] == ["open", "waiting", "waiting"]


# --- GET /rounds and GET /rounds/current ---


async def test_listing_rounds_needs_a_token(client: httpx.AsyncClient) -> None:
    assert_error(await client.get("/rounds"), 401, "UNAUTHENTICATED")


async def test_current_round_works_without_a_token(
    client: httpx.AsyncClient, organiser: dict[str, str], round_ids: dict[int, int]
) -> None:
    """Public, like /standings: the spectator war map reads it without logging in."""
    await open_round(client, organiser, round_ids[1])

    response = await client.get("/rounds/current")

    assert response.status_code == 200
    assert response.json()["id"] == round_ids[1]


async def test_current_round_ignores_a_bad_token(
    client: httpx.AsyncClient, organiser: dict[str, str], round_ids: dict[int, int]
) -> None:
    """A public route never reads the header, so a stale token is not a 401."""
    await open_round(client, organiser, round_ids[1])

    response = await client.get("/rounds/current", headers=bearer("not.a.token"))

    assert response.status_code == 200
    assert response.json()["id"] == round_ids[1]


async def test_list_shows_three_waiting_rounds_with_their_config(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    round_ids: dict[int, int],
) -> None:
    response = await client.get("/rounds", headers=await log_in_new_user())

    assert response.status_code == 200
    body = response.json()
    rounds = body["rounds"]
    assert [item["game"] for item in rounds] == [
        "prisoners_dilemma",
        "theatre_of_war",
        "foreign_aid",
    ]
    for item in rounds:
        assert item["status"] == "waiting"
        assert item["opens_at"] is None
        assert item["closes_at"] is None
        assert item["server_time"] == body["server_time"]
    # Each game's extra keys appear on that game only, not as nulls on the others.
    assert set(rounds[0]["config"]) == SHARED_CONFIG_KEYS
    assert set(rounds[1]["config"]) == SHARED_CONFIG_KEYS | {"troops", "regions"}
    assert set(rounds[2]["config"]) == SHARED_CONFIG_KEYS | {"endowment", "multiplier"}
    assert rounds[0]["config"]["moves"] == ["C", "D"]
    assert rounds[1]["config"]["moves"] == []
    assert rounds[2]["config"]["moves"] == []


async def test_current_is_404_while_every_round_is_waiting(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    round_ids: dict[int, int],
) -> None:
    response = await client.get("/rounds/current", headers=await log_in_new_user())

    assert_error(response, 404, "NOT_FOUND")


async def test_current_is_the_highest_round_that_has_started(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    round_ids: dict[int, int],
) -> None:
    await set_status(round_ids[1], "published")
    await set_status(round_ids[2], "running")

    response = await client.get("/rounds/current", headers=await log_in_new_user())

    assert response.status_code == 200
    assert response.json()["number"] == 2


# --- Transitions that are allowed ---


async def test_open_sets_the_window_from_minutes(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    response = await open_round(client, organiser, round_ids[1], minutes=45)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    assert parse(body["closes_at"]) - parse(body["opens_at"]) == timedelta(minutes=45)


async def test_extend_adds_to_the_deadline(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    opened = (await open_round(client, organiser, round_ids[1])).json()

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/extend", json={"minutes": 10}, headers=organiser
    )

    assert response.status_code == 200
    assert response.json()["status"] == "open"
    gained = parse(response.json()["closes_at"]) - parse(opened["closes_at"])
    assert gained == timedelta(minutes=10)


async def test_extend_after_the_deadline_counts_from_now(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """Adding 10 to a deadline an hour gone would leave it in the past at 00:00."""
    await open_round(client, organiser, round_ids[1])
    await run_sql(
        "UPDATE rounds SET closes_at = now() - interval '1 hour' WHERE id = :id",
        id=round_ids[1],
    )

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/extend", json={"minutes": 10}, headers=organiser
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    closes_at, server_time = parse(body["closes_at"]), parse(body["server_time"])
    assert closes_at > server_time
    assert closes_at - server_time == timedelta(minutes=10)


async def test_start_runs_the_round_and_closes_the_window(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    await open_round(client, organiser, round_ids[1])

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/start", headers=organiser
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "running"
    assert body["closes_at"] == body["server_time"]


# --- Transitions that are not allowed ---


@pytest.mark.parametrize("status", [s for s in ALL_ROUND_STATUSES if s != "waiting"])
async def test_open_only_works_from_waiting(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await open_round(client, organiser, round_ids[1])

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


@pytest.mark.parametrize("status", [s for s in ALL_ROUND_STATUSES if s != "open"])
async def test_extend_only_works_from_open(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/extend", json={"minutes": 5}, headers=organiser
    )

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


@pytest.mark.parametrize("status", [s for s in ALL_ROUND_STATUSES if s != "open"])
async def test_start_only_works_from_open(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/start", headers=organiser
    )

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


@pytest.mark.parametrize("status", ["waiting", "open", "running", "review"])
async def test_a_round_cannot_open_until_the_one_before_is_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await open_round(client, organiser, round_ids[2])

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")


async def test_a_round_needs_every_lower_round_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    await set_status(round_ids[1], "published")

    skipped = await open_round(client, organiser, round_ids[3])
    next_in_line = await open_round(client, organiser, round_ids[2])

    assert_error(skipped, 409, "INVALID_ROUND_TRANSITION")
    assert next_in_line.status_code == 200


# --- Minutes ---


@pytest.mark.parametrize("minutes", [-1, 0, 241, "ten"])
async def test_open_refuses_minutes_out_of_range(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    minutes: int | str,
) -> None:
    response = await open_round(client, organiser, round_ids[1], minutes=minutes)

    assert_error(response, 400, "VALIDATION_ERROR")


@pytest.mark.parametrize("minutes", [0, 241])
async def test_extend_refuses_minutes_out_of_range(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    minutes: int,
) -> None:
    await open_round(client, organiser, round_ids[1])

    response = await client.post(
        f"/admin/rounds/{round_ids[1]}/extend",
        json={"minutes": minutes},
        headers=organiser,
    )

    assert_error(response, 400, "VALIDATION_ERROR")


@pytest.mark.parametrize("minutes", [1, 240])
async def test_minutes_limits_are_inclusive(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    minutes: int,
) -> None:
    response = await open_round(client, organiser, round_ids[1], minutes=minutes)

    assert response.status_code == 200


# --- Organiser only ---

# Every admin route that takes an id. GET /admin/overview has none, so its
# auth is tested in test_admin_overview.py.
ADMIN_CALLS = [
    ("POST", "/admin/rounds/{id}/open", {"minutes": 5}),
    ("POST", "/admin/rounds/{id}/extend", {"minutes": 5}),
    ("POST", "/admin/rounds/{id}/start", None),
    ("POST", "/admin/rounds/{id}/retry", None),
    ("POST", "/admin/rounds/{id}/publish", None),
    ("PATCH", "/admin/teams/{id}", {"status": "disqualified"}),
]


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
async def test_admin_routes_need_a_token(
    client: httpx.AsyncClient, method: str, path: str, body: dict | None
) -> None:
    response = await client.request(method, path.format(id=1), json=body)

    assert_error(response, 401, "UNAUTHENTICATED")


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
async def test_teams_cannot_use_admin_routes(
    client: httpx.AsyncClient,
    log_in_new_user: Callable[..., Awaitable[dict[str, str]]],
    round_ids: dict[int, int],
    method: str,
    path: str,
    body: dict | None,
) -> None:
    headers = await log_in_new_user()

    response = await client.request(
        method, path.format(id=round_ids[1]), json=body, headers=headers
    )

    assert_error(response, 403, "FORBIDDEN")
    rows = await run_sql("SELECT status FROM rounds WHERE id = :id", id=round_ids[1])
    assert rows[0][0] == "waiting"


# --- Ids that do not exist, or that the database could not hold ---


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
@pytest.mark.parametrize("bad_id", [0, -1, 2_147_483_648, 99_999_999_999, -99_999_999_999])
async def test_admin_ids_out_of_range_are_a_400_not_a_crash(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    method: str,
    path: str,
    body: dict | None,
    bad_id: int,
) -> None:
    response = await client.request(
        method, path.format(id=bad_id), json=body, headers=organiser
    )

    assert_error(response, 400, "VALIDATION_ERROR")


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
async def test_highest_possible_id_is_a_clean_404(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    method: str,
    path: str,
    body: dict | None,
) -> None:
    response = await client.request(
        method, path.format(id=2_147_483_647), json=body, headers=organiser
    )

    assert_error(response, 404, "NOT_FOUND")


# --- The row lock ---


async def test_second_open_waits_for_the_first_then_gets_a_409(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """A double click, forced into the worst order.

    This session stands in for the first click, part-way through its transaction.
    The second click must wait at the lock. If it read the row without waiting
    it would see waiting, and both clicks would open the round.
    """
    async with SessionLocal() as first_click:
        row = await rounds_repository.get_round_for_update(first_click, round_ids[1])
        second_click = asyncio.create_task(
            open_round(client, organiser, round_ids[1])
        )
        await wait_until_a_query_is_blocked()
        assert not second_click.done()

        row.status = "open"
        await first_click.commit()

    assert_error(await second_click, 409, "INVALID_ROUND_TRANSITION")


async def test_ten_opens_at_once_succeed_exactly_once(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    responses = await asyncio.gather(
        *(open_round(client, organiser, round_ids[1]) for _ in range(10))
    )

    assert sorted(r.status_code for r in responses) == [200] + [409] * 9


async def test_extends_at_once_all_count(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    opened = (await open_round(client, organiser, round_ids[1])).json()

    await asyncio.gather(
        *(
            client.post(
                f"/admin/rounds/{round_ids[1]}/extend",
                json={"minutes": 1},
                headers=organiser,
            )
            for _ in range(8)
        )
    )

    rows = await run_sql("SELECT closes_at FROM rounds WHERE id = :id", id=round_ids[1])
    assert rows[0][0] - parse(opened["closes_at"]) == timedelta(minutes=8)
