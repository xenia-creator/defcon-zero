"""Tests for scripts/reset_event.py, which wipes a dry run before the real event.

A dry run is played through the API (round 1 published, round 2 open), so every
table the reset touches really has rows in it. The script then runs in this
process, against defcon_test, because conftest has already pointed the app's
engine there. Running it as a separate command would use DATABASE_URL instead.
"""

import httpx

from scripts import reset_event as reset_script
from tests.conftest import PASSWORD, create_user, run_sql
from tests.tournament_helpers import (
    ALWAYS_BETRAY,
    TIT_FOR_TAT,
    ClaimedTeam,
    claim_teams,
    open_round,
    start_round,
    submit,
)


async def play_dry_run(
    client: httpx.AsyncClient,
    claimed_team: ClaimedTeam,
    organiser: dict[str, str],
    round_ids: dict[int, int],
) -> None:
    """Play round 1 to published, then open round 2 with a submission in it."""
    teams = await claim_teams(client, claimed_team, 3)
    await open_round(client, organiser, round_ids[1])
    for team, bot in zip(teams, [TIT_FOR_TAT, ALWAYS_BETRAY, TIT_FOR_TAT]):
        await submit(client, team.headers, round_ids[1], bot)
    await start_round(client, organiser, round_ids[1])
    published = await client.post(f"/admin/rounds/{round_ids[1]}/publish", headers=organiser)
    assert published.status_code == 200
    await open_round(client, organiser, round_ids[2])


async def row_count(table: str) -> int:
    rows = await run_sql(f"SELECT count(*) FROM {table}")
    return rows[0][0]


async def test_refuses_without_yes_and_changes_nothing(
    client, claimed_team, organiser, round_ids, capsys
):
    await play_dry_run(client, claimed_team, organiser, round_ids)
    before = {table: await row_count(table) for table in ("matches", "standings", "submissions", "teams")}

    exit_code = reset_script.main([])

    assert exit_code == 1
    output = capsys.readouterr()
    assert "Database: defcon_test" in output.out
    assert "Refusing to run without --yes" in output.err
    after = {table: await row_count(table) for table in before}
    assert after == before
    assert all(count > 0 for count in before.values())


async def test_reset_wipes_the_event_and_keeps_accounts(
    client, claimed_team, organiser, round_ids, capsys
):
    await play_dry_run(client, claimed_team, organiser, round_ids)
    users_before = await run_sql("SELECT id, username, password_hash, role FROM users ORDER BY id")

    # run() is what main() runs after the --yes check. It is awaited here
    # because main() starts its own event loop, which cannot run inside a test's.
    await reset_script.run()

    for table in ("matches", "standings", "submissions", "teams"):
        assert await row_count(table) == 0
    rounds = await run_sql(
        "SELECT number, status, opens_at, closes_at, seed FROM rounds ORDER BY number"
    )
    assert rounds == [(n, "waiting", None, None, None) for n in (1, 2, 3)]
    # The same accounts with the same passwords, all unclaimed again.
    assert await run_sql(
        "SELECT id, username, password_hash, role FROM users ORDER BY id"
    ) == users_before
    assert await run_sql("SELECT team_id FROM users WHERE team_id IS NOT NULL") == []
    output = capsys.readouterr().out
    assert "Deleted 3 teams." in output
    assert "team accounts" not in output


async def test_reset_puts_the_starting_cuts_back(
    client, claimed_team, organiser, round_ids, capsys
):
    """A cut changed during the dry run must not carry into the real event."""
    await play_dry_run(client, claimed_team, organiser, round_ids)
    edited = await client.patch(
        f"/admin/rounds/{round_ids[2]}", json={"cut": 5}, headers=organiser
    )
    assert edited.status_code == 200
    assert await run_sql("SELECT cut FROM rounds ORDER BY number") == [(15,), (5,), (2,)]

    await reset_script.run()

    assert await run_sql("SELECT cut FROM rounds ORDER BY number") == [(15,), (8,), (2,)]


async def test_reset_clears_a_failed_run(client, claimed_team, organiser, round_ids):
    """A failure from the dry run must not show on the console in the real event."""
    await play_dry_run(client, claimed_team, organiser, round_ids)
    await run_sql(
        "UPDATE rounds SET status = 'running', run_error = 'engine down' WHERE id = :id",
        id=round_ids[2],
    )

    await reset_script.run()

    assert await run_sql("SELECT run_error FROM rounds") == [(None,), (None,), (None,)]


async def test_delete_team_accounts_also_deletes_team_logins_only(
    client, claimed_team, organiser, round_ids, capsys
):
    await play_dry_run(client, claimed_team, organiser, round_ids)
    await create_user("team_unclaimed")
    await create_user("second_boss", "organiser")
    organisers_before = await run_sql(
        "SELECT id, username, password_hash FROM users WHERE role = 'organiser' ORDER BY id"
    )

    await reset_script.run(delete_team_accounts=True)

    for table in ("matches", "standings", "submissions", "teams"):
        assert await row_count(table) == 0
    # Claimed and unclaimed team accounts are both gone, and the organisers are
    # untouched, so they can still log in and run the real event.
    assert await run_sql("SELECT count(*) FROM users WHERE role = 'team'") == [(0,)]
    assert await run_sql(
        "SELECT id, username, password_hash FROM users WHERE role = 'organiser' ORDER BY id"
    ) == organisers_before
    login = await client.post("/auth/login", json={"username": "team_00", "password": PASSWORD})
    assert login.status_code == 401
    login = await client.post("/auth/login", json={"username": "boss", "password": PASSWORD})
    assert login.status_code == 200
    output = capsys.readouterr().out
    assert "Deleted 4 team accounts." in output
    assert "Organiser accounts were kept." in output


def test_main_passes_the_flag_through(monkeypatch):
    # A plain function, not async, so no event loop is running yet and main()
    # can start its own. run() is replaced by a recorder, so nothing touches the
    # database, and the test checks which option main() read from the command line.
    seen = []

    async def record(delete_team_accounts: bool = False) -> None:
        seen.append(delete_team_accounts)

    monkeypatch.setattr(reset_script, "run", record)

    assert reset_script.main(["--yes"]) == 0
    assert reset_script.main(["--yes", "--delete-team-accounts"]) == 0
    assert seen == [False, True]


async def test_delete_team_accounts_still_needs_yes(log_in_new_user, capsys):
    await log_in_new_user("team_a")

    assert reset_script.main(["--delete-team-accounts"]) == 1

    assert await run_sql("SELECT username FROM users") == [("team_a",)]
    assert "Refusing to run without --yes" in capsys.readouterr().err


async def test_after_a_reset_the_event_can_start_again(
    client, claimed_team, organiser, round_ids
):
    await play_dry_run(client, claimed_team, organiser, round_ids)
    await reset_script.run()

    # A team logs in with its old password and claims again, and round 1 opens,
    # which needs every earlier round published, so the rounds really are fresh.
    login = await client.post("/auth/login", json={"username": "team_00", "password": PASSWORD})
    assert login.status_code == 200
    assert login.json()["team_id"] is None
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    claim = await client.post(
        "/teams/claim", json={"territory_code": "RU", "nation_name": "Red Dawn"}, headers=headers
    )
    assert claim.status_code == 200
    await open_round(client, organiser, round_ids[1])
    assert (await client.get("/standings")).json()["nations"] == []


async def test_reset_works_on_an_empty_event(round_ids, capsys):
    await create_user("team_a")

    await reset_script.run()

    assert await row_count("users") == 1
    assert "Deleted 0 teams." in capsys.readouterr().out
