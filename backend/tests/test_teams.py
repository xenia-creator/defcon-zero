"""Tests for GET /territories and POST /teams/claim (docs/api.md section 3)."""

import asyncio
import json
from collections import Counter

import pytest
from sqlalchemy import text

from app.core.database import engine
from app.core.territories import TERRITORIES
from tests.conftest import assert_error


async def claim(client, headers, territory_code="RU", nation_name="Red Dawn"):
    # Written by hand because httpx refuses to encode broken Unicode itself.
    body = json.dumps({"territory_code": territory_code, "nation_name": nation_name})
    return await client.post(
        "/teams/claim",
        content=body,
        headers={**headers, "Content-Type": "application/json"},
    )


async def count_rows(query: str) -> int:
    async with engine.connect() as connection:
        return (await connection.execute(text(query))).scalar_one()


async def count_teams() -> int:
    return await count_rows("SELECT count(*) FROM teams")


async def count_teams_without_a_user() -> int:
    return await count_rows(
        "SELECT count(*) FROM teams t "
        "WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.team_id = t.id)"
    )


# --- GET /territories ---


async def test_territories_needs_a_token(client):
    assert_error(await client.get("/territories"), 401, "UNAUTHENTICATED")


async def test_territories_lists_everything_as_free_at_the_start(
    client, log_in_new_user
):
    headers = await log_in_new_user()

    response = await client.get("/territories", headers=headers)

    assert response.status_code == 200
    territories = response.json()["territories"]
    assert len(territories) == len(TERRITORIES)
    assert {"territory_code": "BR", "name": "Brazil", "claimed": False, "nation_name": None} in territories


async def test_territories_marks_a_claimed_territory(client, log_in_new_user):
    headers = await log_in_new_user()
    await claim(client, headers, "RU", "Red Dawn")

    response = await client.get("/territories", headers=headers)

    territories = response.json()["territories"]
    assert {"territory_code": "RU", "name": "Russia", "claimed": True, "nation_name": "Red Dawn"} in territories
    assert sum(territory["claimed"] for territory in territories) == 1


# --- POST /teams/claim: success ---


async def test_claim_success(client, log_in_new_user):
    headers = await log_in_new_user("team_a")

    response = await claim(client, headers, "RU", "Red Dawn")

    assert response.status_code == 200
    # The contract makes this the same body as GET /me.
    assert response.json() == (await client.get("/me", headers=headers)).json()
    assert response.json()["nation_name"] == "Red Dawn"
    assert response.json()["territory_code"] == "RU"
    assert response.json()["status"] == "active"
    assert response.json()["team_id"] is not None


async def test_claim_stores_the_cleaned_name(client, log_in_new_user):
    headers = await log_in_new_user()

    response = await claim(client, headers, "RU", "  Red   Dawn ")

    assert response.json()["nation_name"] == "Red Dawn"


@pytest.mark.parametrize(
    "name",
    ["abc", "a" * 24, "Team 7", "7 Seas", "UPPER lower 123"],
    ids=["shortest", "longest", "letters-digits", "digit-first", "mixed"],
)
async def test_claim_accepts_valid_names(client, log_in_new_user, name):
    headers = await log_in_new_user()

    response = await claim(client, headers, "RU", name)

    assert response.status_code == 200


async def test_claim_needs_a_token(client):
    assert_error(await claim(client, {}), 401, "UNAUTHENTICATED")


# --- POST /teams/claim: conflicts ---


async def test_territory_taken(client, log_in_new_user):
    first = await log_in_new_user("team_a")
    second = await log_in_new_user("team_b")
    await claim(client, first, "RU", "Red Dawn")

    response = await claim(client, second, "RU", "Blue Sky")

    assert_error(response, 409, "TERRITORY_TAKEN")


@pytest.mark.parametrize(
    "duplicate",
    ["Red Dawn", "RED DAWN", "red dawn", "  Red   Dawn "],
    ids=["same", "upper", "lower", "extra-spaces"],
)
async def test_name_taken(client, log_in_new_user, duplicate):
    first = await log_in_new_user("team_a")
    second = await log_in_new_user("team_b")
    await claim(client, first, "RU", "Red Dawn")

    response = await claim(client, second, "BR", duplicate)

    assert_error(response, 409, "NAME_TAKEN")


async def test_a_refused_claim_can_be_retried(client, log_in_new_user):
    first = await log_in_new_user("team_a")
    second = await log_in_new_user("team_b")
    await claim(client, first, "RU", "Red Dawn")
    await claim(client, second, "RU", "Blue Sky")

    response = await claim(client, second, "BR", "Blue Sky")

    assert response.status_code == 200


async def test_already_claimed(client, log_in_new_user):
    headers = await log_in_new_user()
    await claim(client, headers, "RU", "Red Dawn")

    response = await claim(client, headers, "BR", "Blue Sky")

    assert_error(response, 409, "ALREADY_CLAIMED")
    assert await count_teams() == 1


async def test_organiser_cannot_claim(client, log_in_new_user):
    headers = await log_in_new_user("alice", role="organiser")

    response = await claim(client, headers)

    assert_error(response, 403, "FORBIDDEN")
    assert await count_teams() == 0


# --- POST /teams/claim: validation ---


@pytest.mark.parametrize(
    "name",
    [
        "ab",
        "  ab  ",
        "a" * 25,
        "",
        "     ",
        "123",
        "1" * 24,
        "Red-Dawn",
        "Red_Dawn",
        "Café",
        "Red\tDawn",
        "Red Dawn\n",
        "Red\x00Dawn",
        "Red\ud800",
    ],
    ids=[
        "too-short",
        "too-short-after-trim",
        "too-long",
        "empty",
        "only-spaces",
        "no-letter",
        "no-letter-long",
        "hyphen",
        "underscore",
        "accent",
        "tab",
        "newline",
        "nul",
        "broken-unicode",
    ],
)
async def test_invalid_name(client, log_in_new_user, name):
    headers = await log_in_new_user()

    response = await claim(client, headers, "RU", name)

    assert_error(response, 400, "VALIDATION_ERROR")
    assert await count_teams() == 0


@pytest.mark.parametrize("code", ["XX", "ru", "", "\x00"], ids=["unknown", "lowercase", "empty", "nul"])
async def test_unknown_territory(client, log_in_new_user, code):
    headers = await log_in_new_user()

    response = await claim(client, headers, code, "Red Dawn")

    assert_error(response, 400, "VALIDATION_ERROR")


async def test_claim_with_missing_field(client, log_in_new_user):
    headers = await log_in_new_user()

    response = await client.post(
        "/teams/claim", json={"territory_code": "RU"}, headers=headers
    )

    assert_error(response, 400, "VALIDATION_ERROR")


# --- POST /teams/claim: at the same moment ---
# These send real requests in parallel, each on its own database connection, and
# each one commits. asyncio.gather starts them together and waits for them all.


async def test_many_teams_claiming_one_territory(client, log_in_new_user):
    teams = [await log_in_new_user(f"team_{number}") for number in range(8)]

    responses = await asyncio.gather(
        *[
            claim(client, headers, "RU", f"Nation {chr(65 + number)}")
            for number, headers in enumerate(teams)
        ]
    )

    assert Counter(response.status_code for response in responses) == {200: 1, 409: 7}
    for response in responses:
        if response.status_code == 409:
            assert_error(response, 409, "TERRITORY_TAKEN")
    assert await count_teams() == 1


async def test_many_teams_claiming_one_name_in_different_cases(
    client, log_in_new_user
):
    teams = [await log_in_new_user(f"team_{number}") for number in range(4)]
    names = ["red dawn", "RED DAWN", "Red Dawn", "rEd DaWn"]
    codes = ["AR", "AU", "BR", "CA"]

    responses = await asyncio.gather(
        *[
            claim(client, headers, code, name)
            for headers, code, name in zip(teams, codes, names)
        ]
    )

    assert Counter(response.status_code for response in responses) == {200: 1, 409: 3}
    for response in responses:
        if response.status_code == 409:
            assert_error(response, 409, "NAME_TAKEN")
    assert await count_teams() == 1


async def test_one_user_claiming_many_territories_at_once(client, log_in_new_user):
    # The row lock is what passes this test. The two tables' unique constraints
    # cannot, because every claim here has a different territory and name.
    headers = await log_in_new_user()
    codes = ["AR", "AU", "BR", "CA", "CL", "DK", "EG", "FI"]

    responses = await asyncio.gather(
        *[
            claim(client, headers, code, f"Nation {code}")
            for code in codes
        ]
    )

    assert Counter(response.status_code for response in responses) == {200: 1, 409: 7}
    for response in responses:
        if response.status_code == 409:
            assert_error(response, 409, "ALREADY_CLAIMED")
    assert await count_teams() == 1
    assert await count_teams_without_a_user() == 0
