"""Tests for login, GET /me and the organiser check (docs/api.md section 2)."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from fastapi import FastAPI

from app.api.dependencies import CurrentOrganiser
from app.core.errors import register_error_handling
from app.core.security import JWT_ALGORITHM, create_access_token, decode_access_token
from app.core.settings import settings
from tests.conftest import PASSWORD, assert_error, bearer, create_user


async def log_in(client: httpx.AsyncClient, username: str, password: str):
    return await client.post(
        "/auth/login", json={"username": username, "password": password}
    )


# --- POST /auth/login ---


async def test_login_success_returns_a_working_token(client):
    await create_user("team_a")

    response = await log_in(client, "team_a", PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "token_type", "role", "team_id"}
    assert body["token_type"] == "bearer"
    assert body["role"] == "team"
    assert body["team_id"] is None
    assert decode_access_token(body["access_token"]).role == "team"


async def test_login_organiser_has_null_team_id(client):
    await create_user("alice", role="organiser")

    response = await log_in(client, "alice", PASSWORD)

    assert response.json()["role"] == "organiser"
    assert response.json()["team_id"] is None


async def test_login_returns_team_id_after_claiming(client, log_in_new_user):
    headers = await log_in_new_user("team_a")
    claim = {"territory_code": "RU", "nation_name": "Red Dawn"}
    claimed = await client.post("/teams/claim", json=claim, headers=headers)

    response = await log_in(client, "team_a", PASSWORD)

    assert response.json()["team_id"] == claimed.json()["team_id"]
    assert response.json()["team_id"] is not None


@pytest.mark.parametrize("typed", ["team_a", "TEAM_A", "Team_A"])
async def test_login_ignores_username_case(client, typed):
    await create_user("Team_A")

    response = await log_in(client, typed, PASSWORD)

    assert response.status_code == 200


async def test_wrong_password_and_unknown_username_look_identical(client):
    await create_user("team_a")

    wrong_password = await log_in(client, "team_a", "wrong-password")
    unknown_username = await log_in(client, "nobody", "wrong-password")

    assert_error(wrong_password, 401, "INVALID_CREDENTIALS")
    assert_error(unknown_username, 401, "INVALID_CREDENTIALS")
    # The whole body is compared, so no wording can give away which one was wrong.
    assert wrong_password.content == unknown_username.content


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("team\x00a", "x"),
        ("\ud800", "x"),
        ("team_a", "\ud800"),
        ("", ""),
    ],
    ids=["nul-username", "broken-unicode-username", "broken-unicode-password", "empty"],
)
async def test_login_with_junk_text_is_401_not_a_crash(client, username, password):
    await create_user("team_a")

    # httpx refuses to encode broken Unicode itself, so the JSON is written by
    # hand, with json.dumps escaping it the way a hostile client would send it.
    body = json.dumps({"username": username, "password": password})
    response = await client.post(
        "/auth/login", content=body, headers={"Content-Type": "application/json"}
    )

    assert_error(response, 401, "INVALID_CREDENTIALS")


async def test_login_with_missing_field_is_validation_error(client):
    response = await client.post("/auth/login", json={"username": "team_a"})

    assert_error(response, 400, "VALIDATION_ERROR")


# --- GET /me ---


async def test_me_for_unclaimed_team(client, log_in_new_user):
    headers = await log_in_new_user("team_a")

    response = await client.get("/me", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body.pop("id"), int)
    assert body == {
        "team_id": None,
        "username": "team_a",
        "role": "team",
        "nation_name": None,
        "territory_code": None,
        "status": "active",
    }


async def test_me_for_claimed_team(client, log_in_new_user):
    headers = await log_in_new_user("team_a")
    claim = {"territory_code": "RU", "nation_name": "Red Dawn"}
    await client.post("/teams/claim", json=claim, headers=headers)

    body = (await client.get("/me", headers=headers)).json()

    assert body["nation_name"] == "Red Dawn"
    assert body["territory_code"] == "RU"
    assert body["team_id"] is not None


async def test_me_for_organiser(client, log_in_new_user):
    headers = await log_in_new_user("alice", role="organiser")

    body = (await client.get("/me", headers=headers)).json()

    assert body["role"] == "organiser"
    assert body["team_id"] is None
    assert body["status"] == "active"


async def test_me_without_token(client):
    assert_error(await client.get("/me"), 401, "UNAUTHENTICATED")


async def test_me_with_other_auth_scheme(client):
    response = await client.get("/me", headers={"Authorization": "Basic abc"})

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_me_with_invalid_token(client):
    response = await client.get("/me", headers=bearer("not.a.token"))

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_me_with_expired_token(client, log_in_new_user):
    headers = await log_in_new_user("team_a")
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    claims = {
        "sub": str(user_id),
        "role": "team",
        "exp": datetime.now(UTC) - timedelta(seconds=1),
    }
    expired = jwt.encode(
        claims, settings.jwt_secret.get_secret_value(), algorithm=JWT_ALGORITHM
    )

    response = await client.get("/me", headers=bearer(expired))

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_me_with_token_signed_by_another_secret(client, log_in_new_user):
    headers = await log_in_new_user("team_a")
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    claims = {
        "sub": str(user_id),
        "role": "team",
        "exp": datetime.now(UTC) + timedelta(hours=1),
    }
    forged = jwt.encode(claims, "x" * 64, algorithm=JWT_ALGORITHM)

    response = await client.get("/me", headers=bearer(forged))

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_me_with_token_for_a_user_that_does_not_exist(client):
    token = create_access_token(user_id=999_999, role="team")

    response = await client.get("/me", headers=bearer(token))

    assert_error(response, 401, "UNAUTHENTICATED")


# --- require_organiser ---


@pytest.fixture
async def organiser_client():
    """A client for a tiny app with one organiser-only route.

    This route exists only for these tests, so they check the dependency alone
    and do not change if an admin route's own rules change.
    """
    test_app = FastAPI()
    register_error_handling(test_app)

    @test_app.get("/organiser-only")
    async def organiser_only(organiser: CurrentOrganiser) -> dict[str, str]:
        return {"username": organiser.username}

    transport = httpx.ASGITransport(app=test_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def test_organiser_is_allowed(organiser_client, log_in_new_user):
    headers = await log_in_new_user("alice", role="organiser")

    response = await organiser_client.get("/organiser-only", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


async def test_team_is_forbidden(organiser_client, log_in_new_user):
    headers = await log_in_new_user("team_a")

    response = await organiser_client.get("/organiser-only", headers=headers)

    assert_error(response, 403, "FORBIDDEN")


async def test_no_token_is_401_not_403(organiser_client):
    response = await organiser_client.get("/organiser-only")

    assert_error(response, 401, "UNAUTHENTICATED")


async def test_role_comes_from_the_database_not_the_token(
    client, organiser_client, log_in_new_user
):
    headers = await log_in_new_user("team_a")
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    # Correctly signed, but it claims a role the database does not agree with.
    outdated_token = create_access_token(user_id, "organiser")

    response = await organiser_client.get(
        "/organiser-only", headers=bearer(outdated_token)
    )

    assert_error(response, 403, "FORBIDDEN")
