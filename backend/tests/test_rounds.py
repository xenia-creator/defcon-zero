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
    "cut",
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
    assert [item["config"]["cut"] for item in rounds] == [15, 8, 2]


async def test_creating_rounds_stores_the_cut_in_its_own_column(
    round_ids: dict[int, int],
) -> None:
    """config.cut in a response comes from the cut column, not the config JSON."""
    rows = await run_sql("SELECT number, cut, config ? 'cut' FROM rounds ORDER BY number")

    assert rows == [(1, 15, False), (2, 8, False), (3, 2, False)]


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
    ("POST", "/admin/rounds/{id}/set-time", {"minutes": 5}),
    ("POST", "/admin/rounds/{id}/start", None),
    ("POST", "/admin/rounds/{id}/retry", None),
    ("POST", "/admin/rounds/{id}/publish", None),
    ("PATCH", "/admin/rounds/{id}", {"cut": 10}),
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


# --- Editing the cut: PATCH /admin/rounds/{id} ---


async def set_cut(
    client: httpx.AsyncClient, headers: dict[str, str], round_id: int, body: object
) -> httpx.Response:
    return await client.patch(f"/admin/rounds/{round_id}", json=body, headers=headers)


async def stored_cuts() -> list[int]:
    rows = await run_sql("SELECT cut FROM rounds ORDER BY number")
    return [row[0] for row in rows]


def error_message(response: httpx.Response) -> str:
    return response.json()["error"]["message"]


async def test_patch_sets_the_cut_and_returns_the_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    response = await set_cut(client, organiser, round_ids[1], {"cut": 10})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == round_ids[1]
    assert body["config"]["cut"] == 10
    assert body["config"]["moves"] == ["C", "D"]
    assert "server_time" in body and "seed" not in body
    assert await stored_cuts() == [10, 8, 2]
    listed = (await client.get("/rounds", headers=organiser)).json()["rounds"]
    assert listed[0]["config"]["cut"] == 10


@pytest.mark.parametrize("status", ["waiting", "open", "running", "review"])
async def test_patch_works_until_the_round_is_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await set_cut(client, organiser, round_ids[1], {"cut": 12})

    assert response.status_code == 200
    assert response.json()["status"] == status
    assert await stored_cuts() == [12, 8, 2]


async def test_patch_refuses_a_published_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    await set_status(round_ids[1], "published")

    response = await set_cut(client, organiser, round_ids[1], {"cut": 12})

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")
    assert await stored_cuts() == [15, 8, 2]


@pytest.mark.parametrize(
    "body",
    [
        {"cut": 0},
        {"cut": -1},
        {"cut": 2.5},
        {"cut": "ten"},
        {"cut": None},
        {},
    ],
)
async def test_patch_refuses_a_cut_that_is_not_a_whole_number_of_at_least_1(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    body: dict,
) -> None:
    response = await set_cut(client, organiser, round_ids[2], body)

    assert_error(response, 400, "VALIDATION_ERROR")
    assert await stored_cuts() == [15, 8, 2]


async def test_patch_refuses_a_cut_above_the_previous_rounds(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    response = await set_cut(client, organiser, round_ids[2], {"cut": 16})

    assert_error(response, 400, "VALIDATION_ERROR")
    assert "Raise Round 1's cut first" in error_message(response)
    assert await stored_cuts() == [15, 8, 2]


async def test_patch_names_no_round_to_change_when_the_previous_is_published(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """A published round's cut can no longer change, so the message cannot ask for it."""
    await set_status(round_ids[1], "published")

    response = await set_cut(client, organiser, round_ids[2], {"cut": 16})

    assert_error(response, 400, "VALIDATION_ERROR")
    assert error_message(response) == (
        "Round 1 kept 15 teams, so Round 2 can keep at most 15."
    )


async def test_patch_refuses_a_cut_below_the_next_rounds(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    response = await set_cut(client, organiser, round_ids[1], {"cut": 7})

    assert_error(response, 400, "VALIDATION_ERROR")
    assert "Lower Round 2's cut first" in error_message(response)
    assert await stored_cuts() == [15, 8, 2]


async def test_patch_refuses_a_cut_below_the_final_rounds_fixed_cut(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """The final round's cut cannot be lowered, so the message does not ask for it."""
    response = await set_cut(client, organiser, round_ids[2], {"cut": 1})

    assert_error(response, 400, "VALIDATION_ERROR")
    assert error_message(response) == (
        "The final round's cut is fixed at 2, so Round 2 must keep at least 2."
    )


async def test_a_published_next_round_does_not_limit_the_cut(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """The rule as written. Rounds publish in order, so the API alone never reaches this."""
    await set_status(round_ids[2], "published")

    response = await set_cut(client, organiser, round_ids[1], {"cut": 3})

    assert response.status_code == 200
    assert await stored_cuts() == [3, 8, 2]


@pytest.mark.parametrize("number,cut", [(1, 8), (1, 15), (2, 2), (2, 15)])
async def test_patch_limits_are_inclusive(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    number: int,
    cut: int,
) -> None:
    response = await set_cut(client, organiser, round_ids[number], {"cut": cut})

    assert response.status_code == 200
    assert response.json()["config"]["cut"] == cut


async def test_lowering_the_next_round_first_lets_a_round_go_lower(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    assert (await set_cut(client, organiser, round_ids[2], {"cut": 4})).status_code == 200

    response = await set_cut(client, organiser, round_ids[1], {"cut": 4})

    assert response.status_code == 200
    assert await stored_cuts() == [4, 4, 2]


@pytest.mark.parametrize("cut", [2, 3])
async def test_patch_refuses_the_final_round(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    cut: int,
) -> None:
    response = await set_cut(client, organiser, round_ids[3], {"cut": cut})

    assert_error(response, 400, "VALIDATION_ERROR")
    assert error_message(response) == "The final round's cut is fixed at 2."
    assert await stored_cuts() == [15, 8, 2]


async def test_patch_waits_for_a_publish_then_gets_a_409(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """An edit during a publish must not change a cut that is already being applied."""
    await set_status(round_ids[1], "review")
    async with SessionLocal() as publish:
        row = await rounds_repository.get_round_for_update(publish, round_ids[1])
        edit = asyncio.create_task(set_cut(client, organiser, round_ids[1], {"cut": 10}))
        await wait_until_a_query_is_blocked()
        assert not edit.done()

        row.status = "published"
        await publish.commit()

    assert_error(await edit, 409, "INVALID_ROUND_TRANSITION")
    assert await stored_cuts() == [15, 8, 2]


async def test_patch_waits_for_a_neighbours_edit_and_checks_its_new_cut(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """Both rounds are locked, so neither edit can pass against the other's old cut.

    Here round 2 is raised to 12 while round 1 is being lowered to 10. Each is
    fine against the old cuts, but together round 2 would keep more than round 1.
    """
    async with SessionLocal() as other_edit:
        [round_2] = await rounds_repository.lock_rounds_by_number(other_edit, [2])
        edit = asyncio.create_task(set_cut(client, organiser, round_ids[1], {"cut": 10}))
        await wait_until_a_query_is_blocked()
        assert not edit.done()

        round_2.cut = 12
        await other_edit.commit()

    response = await edit
    assert_error(response, 400, "VALIDATION_ERROR")
    assert "Lower Round 2's cut first" in error_message(response)
    assert await stored_cuts() == [15, 12, 2]


# --- Setting the time left: POST /admin/rounds/{id}/set-time ---


async def set_time(
    client: httpx.AsyncClient, headers: dict[str, str], round_id: int, body: object
) -> httpx.Response:
    return await client.post(
        f"/admin/rounds/{round_id}/set-time", json=body, headers=headers
    )


def time_left(body: dict) -> timedelta:
    """closes_at - server_time, as the frontend works out its timer."""
    return parse(body["closes_at"]) - parse(body["server_time"])


async def test_set_time_shortens_the_window(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    opened = (await open_round(client, organiser, round_ids[1], minutes=30)).json()

    response = await set_time(client, organiser, round_ids[1], {"minutes": 5})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    assert time_left(body) == timedelta(minutes=5)
    assert parse(body["closes_at"]) < parse(opened["closes_at"])
    # opens_at is the moment the window first opened, so it does not move.
    assert body["opens_at"] == opened["opens_at"]
    rows = await run_sql("SELECT closes_at FROM rounds WHERE id = :id", id=round_ids[1])
    assert rows[0][0] == parse(body["closes_at"])


async def test_set_time_lengthens_the_window(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    opened = (await open_round(client, organiser, round_ids[1], minutes=30)).json()

    response = await set_time(client, organiser, round_ids[1], {"minutes": 90})

    assert response.status_code == 200
    body = response.json()
    assert time_left(body) == timedelta(minutes=90)
    assert parse(body["closes_at"]) > parse(opened["closes_at"])


async def test_set_time_after_the_deadline_counts_from_now(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    await open_round(client, organiser, round_ids[1])
    await run_sql(
        "UPDATE rounds SET closes_at = now() - interval '1 hour' WHERE id = :id",
        id=round_ids[1],
    )

    response = await set_time(client, organiser, round_ids[1], {"minutes": 10})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    assert time_left(body) == timedelta(minutes=10)


async def test_set_time_does_not_add_up_like_extend(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """Two set-times leave the window at the last one, not their sum."""
    await open_round(client, organiser, round_ids[1])

    await set_time(client, organiser, round_ids[1], {"minutes": 20})
    response = await set_time(client, organiser, round_ids[1], {"minutes": 20})

    assert time_left(response.json()) == timedelta(minutes=20)


@pytest.mark.parametrize("status", [s for s in ALL_ROUND_STATUSES if s != "open"])
async def test_set_time_only_works_from_open(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    status: str,
) -> None:
    await set_status(round_ids[1], status)

    response = await set_time(client, organiser, round_ids[1], {"minutes": 5})

    assert_error(response, 409, "INVALID_ROUND_TRANSITION")
    rows = await run_sql("SELECT closes_at FROM rounds WHERE id = :id", id=round_ids[1])
    assert rows[0][0] is None


@pytest.mark.parametrize(
    "body",
    [
        {"minutes": -1},
        {"minutes": 0},
        {"minutes": 241},
        {"minutes": 2.5},
        {"minutes": "ten"},
        {"minutes": None},
        {},
    ],
)
async def test_set_time_refuses_bad_minutes(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    body: dict,
) -> None:
    opened = (await open_round(client, organiser, round_ids[1])).json()

    response = await set_time(client, organiser, round_ids[1], body)

    assert_error(response, 400, "VALIDATION_ERROR")
    rows = await run_sql("SELECT closes_at FROM rounds WHERE id = :id", id=round_ids[1])
    assert rows[0][0] == parse(opened["closes_at"])


@pytest.mark.parametrize("minutes", [1, 240])
async def test_set_time_minutes_limits_are_inclusive(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
    minutes: int,
) -> None:
    await open_round(client, organiser, round_ids[1])

    response = await set_time(client, organiser, round_ids[1], {"minutes": minutes})

    assert response.status_code == 200
    assert time_left(response.json()) == timedelta(minutes=minutes)


async def test_set_time_waits_for_a_start_then_gets_a_409(
    client: httpx.AsyncClient,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """A set-time sent as the round starts must not reopen the closed window."""
    await open_round(client, organiser, round_ids[1])
    async with SessionLocal() as start:
        row = await rounds_repository.get_round_for_update(start, round_ids[1])
        late = asyncio.create_task(
            set_time(client, organiser, round_ids[1], {"minutes": 30})
        )
        await wait_until_a_query_is_blocked()
        assert not late.done()

        row.status = "running"
        await start.commit()

    assert_error(await late, 409, "INVALID_ROUND_TRANSITION")
