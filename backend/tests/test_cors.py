"""Tests for CORS: only origins in the CORS_ORIGINS setting get CORS headers.

The tests run with the default setting (the Vite dev server), unless backend/.env
sets CORS_ORIGINS, so they read the allowed origin from settings rather than
hardcoding it.
"""

from app.core.settings import Settings, settings

OTHER_ORIGIN = "https://evil.example.com"


async def test_an_allowed_origin_gets_cors_headers(client):
    origin = settings.cors_origins[0]

    response = await client.get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


async def test_another_origin_gets_no_cors_headers(client):
    response = await client.get("/health", headers={"Origin": OTHER_ORIGIN})

    # The request is still served, but without the header the browser hides the
    # response from the page that asked.
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


async def test_an_allowed_origin_passes_the_preflight(client):
    # The browser sends this OPTIONS request before a POST with Authorization
    # and Idempotency-Key headers, and only sends the POST if it passes.
    origin = settings.cors_origins[0]

    response = await client.options(
        "/submissions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, idempotency-key",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "idempotency-key" in allowed_headers


async def test_another_origin_fails_the_preflight(client):
    response = await client.options(
        "/submissions",
        headers={
            "Origin": OTHER_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_is_read_as_a_comma_separated_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example.org/ ,https://b.example.org,")

    assert Settings().cors_origins == ["https://a.example.org", "https://b.example.org"]


def test_cors_origins_defaults_to_the_vite_dev_server(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    # _env_file=None skips backend/.env, so only the default is left.
    defaults = Settings(_env_file=None, database_url="x", jwt_secret="x")

    assert defaults.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
