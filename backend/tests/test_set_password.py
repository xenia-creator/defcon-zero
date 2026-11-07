"""Tests for scripts/set_password.py, which changes an account's password.

Two kinds of test, because main() starts its own event loop, and that cannot run
inside an async test:
- Plain tests drive main() with getpass replaced by typed answers and the
  database save replaced by a recorder, to check the prompts, the messages and
  that the password is never printed.
- Async tests await save_password itself, against defcon_test, to check the real
  update and that login then takes the new password.
"""

import pytest

from scripts import set_password as script
from tests.conftest import PASSWORD, create_user, run_sql

NEW_PASSWORD = "a-brand-new-organiser-password"


def type_answers(monkeypatch: pytest.MonkeyPatch, *answers: str) -> None:
    """Make getpass return these answers in order, as if they were typed."""
    remaining = list(answers)
    monkeypatch.setattr(script.getpass, "getpass", lambda prompt="": remaining.pop(0))


def record_saves(monkeypatch: pytest.MonkeyPatch, account_exists: bool = True) -> list:
    """Replace the database save. Returns the list of (username, password) it got."""
    saves = []

    async def fake_save(username: str, password: str) -> bool:
        saves.append((username, password))
        return account_exists

    monkeypatch.setattr(script, "save_password", fake_save)
    return saves


# --- main(): prompts, messages, and the password never shown ---


def test_matching_passwords_are_saved(monkeypatch, capsys):
    type_answers(monkeypatch, NEW_PASSWORD, NEW_PASSWORD)
    saves = record_saves(monkeypatch)

    assert script.main(["alice"]) == 0

    assert saves == [("alice", NEW_PASSWORD)]
    output = capsys.readouterr()
    assert output.out.startswith("Database: defcon_test\n")
    assert "Password changed for alice." in output.out
    assert NEW_PASSWORD not in output.out + output.err


def test_different_passwords_change_nothing(monkeypatch, capsys):
    type_answers(monkeypatch, NEW_PASSWORD, NEW_PASSWORD + "x")
    saves = record_saves(monkeypatch)

    assert script.main(["alice"]) == 1

    assert saves == []
    output = capsys.readouterr()
    assert "do not match" in output.err
    assert NEW_PASSWORD not in output.out + output.err


def test_an_empty_password_is_refused_before_asking_again(monkeypatch, capsys):
    # Only one answer: a second prompt would fail the test with IndexError.
    type_answers(monkeypatch, "")
    saves = record_saves(monkeypatch)

    assert script.main(["alice"]) == 1

    assert saves == []
    assert "empty" in capsys.readouterr().err


def test_an_unusable_character_is_refused(monkeypatch, capsys):
    type_answers(monkeypatch, "bad\x00password")
    saves = record_saves(monkeypatch)

    assert script.main(["alice"]) == 1

    assert saves == []
    assert "unusable character" in capsys.readouterr().err


def test_an_unknown_username_is_reported(monkeypatch, capsys):
    type_answers(monkeypatch, NEW_PASSWORD, NEW_PASSWORD)
    record_saves(monkeypatch, account_exists=False)

    assert script.main(["nobody"]) == 1

    output = capsys.readouterr()
    assert "No account named nobody" in output.err
    assert "Password changed" not in output.out
    assert NEW_PASSWORD not in output.out + output.err


# --- save_password: the real update, in defcon_test ---


async def log_in_status(client, username: str, password: str) -> int:
    response = await client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    return response.status_code


async def test_the_new_password_works_and_the_old_one_does_not(client):
    await create_user("alice", "organiser")

    assert await script.save_password("alice", NEW_PASSWORD) is True

    assert await log_in_status(client, "alice", NEW_PASSWORD) == 200
    assert await log_in_status(client, "alice", PASSWORD) == 401


async def test_only_that_account_changes(client):
    await create_user("alice", "organiser")
    await create_user("bob", "organiser")
    await create_user("team_a")
    others_before = await run_sql(
        "SELECT username, password_hash FROM users WHERE username <> 'alice' ORDER BY username"
    )

    await script.save_password("alice", NEW_PASSWORD)

    assert await run_sql(
        "SELECT username, password_hash FROM users WHERE username <> 'alice' ORDER BY username"
    ) == others_before


async def test_the_username_ignores_case(client):
    await create_user("alice", "organiser")

    assert await script.save_password("Alice", NEW_PASSWORD) is True

    assert await log_in_status(client, "alice", NEW_PASSWORD) == 200


async def test_the_password_is_stored_as_an_argon2_hash():
    await create_user("alice", "organiser")

    await script.save_password("alice", NEW_PASSWORD)

    [(stored,)] = await run_sql("SELECT password_hash FROM users WHERE username = 'alice'")
    assert stored.startswith("$argon2")
    assert NEW_PASSWORD not in stored


async def test_an_unknown_username_changes_nothing():
    await create_user("alice", "organiser")
    before = await run_sql("SELECT username, password_hash FROM users")

    assert await script.save_password("nobody", NEW_PASSWORD) is False

    assert await run_sql("SELECT username, password_hash FROM users") == before
