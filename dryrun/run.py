#!/usr/bin/env python3
"""Dry-run automation for Defcon Zero.

Logs in a list of test teams, claims a territory and a made-up nation name for
each, submits one bot per team for the currently open round, waits for every
submission to be accepted or rejected, and prints a summary table.

The script talks to the backend ONLY through the HTTP API described in
docs/api.md. It never opens, starts, publishes or closes a round: that stays
manual in the admin console.

Team credentials (never printed) come from one of, in this order:
  1. --teams-file PATH (or env DRYRUN_TEAMS_FILE): a JSON file, either
       [{"username": "team_01", "password": "..."}, ...]
     or {"team_01": "...", "team_02": "..."}
  2. env DRYRUN_USERNAMES="team_01,team_02,..." plus DRYRUN_PASSWORD (one
     shared password for all of them)
  3. dryrun/teams.json next to this script, if it exists

Usage:
  python dryrun/run.py --base-url http://localhost:8000 --teams-file teams.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_BASE_URL = "http://localhost:8000"
SCRIPT_DIR = Path(__file__).resolve().parent
BOTS_DIR = SCRIPT_DIR / "bots"
DEFAULT_TEAMS_FILE = SCRIPT_DIR / "teams.json"

# Round `game` key (docs/api.md section 4) -> bot filename prefix.
GAME_PREFIX = {
    "prisoners_dilemma": "pd_",
    "theatre_of_war": "tow_",
    "foreign_aid": "fa_",
}

TERMINAL_STATUSES = {"accepted", "rejected"}
MAX_CODE_BYTES = 65536  # API limit for `code` (section 5)
MAX_CLAIM_ATTEMPTS = 8

# Made-up nation names: 3-24 chars, letters/digits/spaces only (section 3).
NATION_NAMES = [
    "Valdoria", "Northmere", "Kestrel Union", "Solmark", "Ardenfall",
    "Brightwater", "Ironvale", "Zephyria", "Calderon Reach", "Tarnhold",
    "Marrow Coast", "Eldoria", "Quillon", "Stormhaven", "Veyra",
    "Oakridge Free State", "Dunmoor", "Lumeria", "Ashgrove", "Pellora",
]


class ApiError(Exception):
    """An HTTP/API failure. `code` is the API error code, or a local one
    (NETWORK_ERROR, INVALID_RESPONSE, HTTP_<status>)."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{code} (HTTP {status}): {message}")
        self.status = status
        self.code = code
        self.message = message


class StepError(Exception):
    """A per-team problem that is not an API error (bad bot file, etc.)."""


@dataclass
class Team:
    username: str
    password: str = field(repr=False)
    token: str = field(default="", repr=False)
    nation_name: str = ""
    territory_code: str = ""
    bot: Path | None = None
    submission_id: int | None = None
    last_status: str = ""
    # SUBMITTED until the backend confirms ACCEPTED/REJECTED; FAILED/TIMEOUT
    # mean we could not get a terminal status from the backend.
    outcome: str = "NOT STARTED"
    detail: str = ""


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------

class ApiClient:
    """Minimal JSON-over-HTTP client built on the standard library."""

    def __init__(self, base_url: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str = "",
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        retries: int = 0,
    ) -> dict[str, Any]:
        """Send a request and return the parsed JSON object.

        Only network errors/timeouts are retried (`retries` extra attempts).
        API errors raise ApiError straight away.
        """
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req_headers = {"Accept": "application/json"}
        if data is not None:
            req_headers["Content-Type"] = "application/json"
        if token:
            req_headers["Authorization"] = f"Bearer {token}"
        if headers:
            req_headers.update(headers)

        attempt = 0
        while True:
            req = urllib.request.Request(
                self.base_url + path, data=data, headers=req_headers, method=method
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return self._parse(resp.status, resp.read())
            except urllib.error.HTTPError as exc:
                raise self._error_from_http(exc) from None
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt >= retries:
                    reason = getattr(exc, "reason", exc)
                    raise ApiError(0, "NETWORK_ERROR", f"{method} {path}: {reason}") from None
                attempt += 1
                time.sleep(min(2 ** attempt, 5))

    @staticmethod
    def _parse(status: int, raw: bytes) -> dict[str, Any]:
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(status, "INVALID_RESPONSE", "response is not valid JSON") from None
        if not isinstance(parsed, dict):
            raise ApiError(status, "INVALID_RESPONSE", "response is not a JSON object")
        return parsed

    @staticmethod
    def _error_from_http(exc: urllib.error.HTTPError) -> ApiError:
        """Build an ApiError from the documented error shape (section 1)."""
        code, message = f"HTTP_{exc.code}", str(exc.reason)
        try:
            err = json.loads(exc.read().decode("utf-8")).get("error", {})
            code = str(err.get("code", code))
            message = str(err.get("message", message))
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError, OSError):
            pass  # keep the generic HTTP_<status> code
        return ApiError(exc.code, code, message)


def require(data: dict[str, Any], key: str, kind: type) -> Any:
    """Return data[key] or raise INVALID_RESPONSE if missing/wrong type."""
    value = data.get(key)
    if not isinstance(value, kind) or isinstance(value, bool) and kind is int:
        raise ApiError(200, "INVALID_RESPONSE", f"missing or invalid '{key}' in response")
    return value


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def load_teams(teams_file: str | None) -> list[Team]:
    """Load team credentials from a file or the environment."""
    usernames = os.environ.get("DRYRUN_USERNAMES", "")
    shared_password = os.environ.get("DRYRUN_PASSWORD", "")
    pairs: list[tuple[str, str]] = []

    path: Path | None = Path(teams_file) if teams_file else None
    if path is None and not (usernames and shared_password) and DEFAULT_TEAMS_FILE.exists():
        path = DEFAULT_TEAMS_FILE

    if path is not None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Cannot read teams file {path}: {exc}")
        if isinstance(raw, dict):
            pairs = [(str(u), str(p)) for u, p in raw.items()]
        elif isinstance(raw, list):
            for entry in raw:
                if not isinstance(entry, dict):
                    raise SystemExit("Teams file entries must be objects with username/password.")
                pairs.append((str(entry.get("username", "")), str(entry.get("password", ""))))
        else:
            raise SystemExit("Teams file must be a JSON list or object.")
    elif usernames and shared_password:
        pairs = [(u.strip(), shared_password) for u in usernames.split(",") if u.strip()]
    else:
        raise SystemExit(
            "No team credentials found. Use --teams-file / DRYRUN_TEAMS_FILE, or set "
            "DRYRUN_USERNAMES and DRYRUN_PASSWORD. See the docstring in dryrun/run.py."
        )

    seen: set[str] = set()
    teams: list[Team] = []
    for username, password in pairs:
        if not username or not password:
            raise SystemExit("Every team needs a non-empty username and password.")
        if username.lower() in seen:  # usernames are case-insensitive (API v4)
            raise SystemExit(f"Duplicate username in credentials: {username}")
        seen.add(username.lower())
        teams.append(Team(username=username, password=password))
    return teams


# --------------------------------------------------------------------------
# Round detection and bot selection
# --------------------------------------------------------------------------

def detect_round(client: ApiClient) -> dict[str, Any]:
    """Read the current round from the public GET /rounds/current."""
    try:
        rnd = client.request("GET", "/rounds/current", retries=2)
    except ApiError as exc:
        if exc.code == "NOT_FOUND":
            raise SystemExit("No round has started yet. Nothing to submit.")
        raise SystemExit(f"Could not read the current round: {exc}")
    try:
        require(rnd, "id", int)
        require(rnd, "game", str)
        require(rnd, "status", str)
    except ApiError as exc:
        raise SystemExit(f"Unexpected /rounds/current response: {exc.message}")
    return rnd


def seconds_left(rnd: dict[str, Any]) -> float | None:
    """Time until the round closes, using the server's clock (never ours)."""
    try:
        closes = datetime.fromisoformat(str(rnd["closes_at"]).replace("Z", "+00:00"))
        now = datetime.fromisoformat(str(rnd["server_time"]).replace("Z", "+00:00"))
        return (closes - now).total_seconds()
    except (KeyError, ValueError):
        return None


def list_bots(prefix: str) -> list[Path]:
    return sorted(p for p in BOTS_DIR.glob(f"{prefix}*.py") if p.is_file())


# --------------------------------------------------------------------------
# Per-team steps
# --------------------------------------------------------------------------

def login(client: ApiClient, team: Team) -> None:
    """POST /auth/login and keep this team's token."""
    data = client.request(
        "POST", "/auth/login",
        body={"username": team.username, "password": team.password}, retries=1,
    )
    team.token = require(data, "access_token", str)
    role = data.get("role")
    if role != "team":
        raise StepError(f"account role is '{role}', expected 'team'")


def candidate_names(offset: int) -> list[str]:
    """Nation names in a rotation starting at `offset`, then numbered fallbacks."""
    rotated = NATION_NAMES[offset % len(NATION_NAMES):] + NATION_NAMES[: offset % len(NATION_NAMES)]
    return rotated + [f"Dryrun Nation {n}" for n in range(1, 100)]


def ensure_claim(client: ApiClient, team: Team, index: int) -> None:
    """Claim a free territory with a unique made-up name (skip if already claimed)."""
    me = client.request("GET", "/me", token=team.token, retries=1)
    if me.get("territory_code") and me.get("nation_name"):
        team.territory_code = str(me["territory_code"])
        team.nation_name = str(me["nation_name"])
        return

    tried_codes: set[str] = set()
    tried_names: set[str] = set()
    for _ in range(MAX_CLAIM_ATTEMPTS):
        # Re-read availability each time: other teams (or people) may have claimed.
        listing = client.request("GET", "/territories", retries=1)
        territories = listing.get("territories")
        if not isinstance(territories, list):
            raise ApiError(200, "INVALID_RESPONSE", "missing 'territories' list")
        free = [
            str(t["territory_code"]) for t in territories
            if isinstance(t, dict) and t.get("territory_code") and not t.get("claimed")
            and str(t["territory_code"]) not in tried_codes
        ]
        if not free:
            raise StepError("no free territory available")
        used_names = {
            str(t["nation_name"]).lower() for t in territories
            if isinstance(t, dict) and t.get("nation_name")
        } | {n.lower() for n in tried_names}
        name = next(n for n in candidate_names(index) if n.lower() not in used_names)
        code = free[0]

        try:
            claimed = client.request(
                "POST", "/teams/claim", token=team.token,
                body={"territory_code": code, "nation_name": name},
            )
        except ApiError as exc:
            if exc.code == "TERRITORY_TAKEN":
                tried_codes.add(code)
            elif exc.code == "NAME_TAKEN":
                tried_names.add(name)
            elif exc.code == "ALREADY_CLAIMED":
                me = client.request("GET", "/me", token=team.token, retries=1)
                team.territory_code = str(me.get("territory_code") or "")
                team.nation_name = str(me.get("nation_name") or "")
                return
            else:
                raise
            continue
        team.territory_code = str(claimed.get("territory_code") or code)
        team.nation_name = str(claimed.get("nation_name") or name)
        return
    raise StepError(f"could not claim a territory after {MAX_CLAIM_ATTEMPTS} attempts")


def submit_bot(client: ApiClient, team: Team, round_id: int) -> None:
    """POST /submissions with the team's bot source code."""
    if team.bot is None:
        raise StepError("no bot assigned")
    try:
        code = team.bot.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise StepError(f"cannot read bot file: {exc}")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise StepError("bot file exceeds the 64 KB API limit")

    # One Idempotency-Key per submission, reused on retries so a timeout can
    # never create a duplicate version (section 5).
    data = client.request(
        "POST", "/submissions", token=team.token,
        body={"round_id": round_id, "code": code, "blocks": {"modules": []}},
        headers={"Idempotency-Key": str(uuid.uuid4())}, retries=2,
    )
    team.submission_id = require(data, "id", int)
    team.last_status = str(data.get("status", "pending"))


def process_team(client: ApiClient, team: Team, index: int, round_id: int) -> None:
    """Login -> claim -> submit for one team. Any failure is recorded, not raised."""
    try:
        login(client, team)
        ensure_claim(client, team, index)
        print(f"[{team.username}] {team.nation_name} ({team.territory_code}) "
              f"submitting {team.bot.name if team.bot else '?'}")
        submit_bot(client, team, round_id)
        team.outcome = "SUBMITTED"
    except ApiError as exc:
        team.outcome, team.detail = "FAILED", f"{exc.code}: {exc.message}"
    except StepError as exc:
        team.outcome, team.detail = "FAILED", str(exc)
    except Exception as exc:  # keep going: one broken team must not stop the rest
        team.outcome, team.detail = "FAILED", f"unexpected {type(exc).__name__}: {exc}"
    if team.outcome == "FAILED":
        print(f"[{team.username}] FAILED - {team.detail}")


# --------------------------------------------------------------------------
# Polling and reporting
# --------------------------------------------------------------------------

def poll_submissions(
    client: ApiClient, teams: list[Team], interval: float, timeout: float
) -> None:
    """Poll GET /submissions/{id} until each one is accepted/rejected or time runs out.

    A submission is only labelled ACCEPTED/REJECTED when the backend says so.
    """
    pending = [t for t in teams if t.outcome == "SUBMITTED"]
    deadline = time.monotonic() + timeout
    while pending and time.monotonic() < deadline:
        for team in list(pending):
            try:
                sub = client.request(
                    "GET", f"/submissions/{team.submission_id}", token=team.token, retries=1
                )
                status = require(sub, "status", str)
            except ApiError as exc:
                if exc.code in {"UNAUTHENTICATED", "NOT_FOUND"}:
                    team.outcome, team.detail = "FAILED", f"{exc.code}: {exc.message}"
                    pending.remove(team)
                else:  # transient (network, bad payload): keep trying until timeout
                    team.detail = f"last poll error: {exc.code}"
                continue
            team.last_status = status
            if status in TERMINAL_STATUSES:
                team.outcome = status.upper()
                team.detail = error_text(sub) if status == "rejected" else ""
                pending.remove(team)
                print(f"[{team.username}] submission {team.submission_id} -> {team.outcome}")
        if pending:
            time.sleep(interval)

    for team in pending:
        team.outcome = "TIMEOUT"
        team.detail = f"still '{team.last_status or 'unknown'}' after {timeout:g}s"


def error_text(submission: dict[str, Any]) -> str:
    """Short rejection reason from check.error, if the backend gave one."""
    check = submission.get("check")
    err = check.get("error") if isinstance(check, dict) else None
    return " ".join(str(err).split())[:70] if err else ""


def print_summary(teams: list[Team]) -> None:
    rows = [
        (t.username, t.bot.name if t.bot else "-", t.outcome, t.detail) for t in teams
    ]
    headers = ("Team", "Bot", "Status", "Detail")
    widths = [max(len(str(r[i])) for r in [headers, *rows]) for i in range(4)]

    def line(cells: tuple[str, ...]) -> str:
        return "  ".join(str(c).ljust(w) for c, w in zip(cells, widths)).rstrip()

    print()
    print(line(headers))
    print(line(tuple("-" * w for w in widths)))
    for row in rows:
        print(line(row))

    accepted = sum(t.outcome == "ACCEPTED" for t in teams)
    rejected = sum(t.outcome == "REJECTED" for t in teams)
    unresolved = len(teams) - accepted - rejected
    print(f"\nAccepted: {accepted}   Rejected: {rejected}   "
          f"Failed/timed out (no terminal status): {unresolved}   Total teams: {len(teams)}")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Defcon Zero dry-run automation (API only).")
    parser.add_argument("--base-url", default=os.environ.get("DRYRUN_BASE_URL", DEFAULT_BASE_URL),
                        help=f"backend URL (env DRYRUN_BASE_URL, default {DEFAULT_BASE_URL})")
    parser.add_argument("--teams-file", default=os.environ.get("DRYRUN_TEAMS_FILE"),
                        help="JSON file with team credentials (env DRYRUN_TEAMS_FILE)")
    parser.add_argument("--http-timeout", type=float, default=15.0,
                        help="per-request timeout in seconds (default 15)")
    parser.add_argument("--poll-interval", type=float, default=1.5,
                        help="seconds between status polls (default 1.5)")
    parser.add_argument("--poll-timeout", type=float, default=180.0,
                        help="max seconds to wait for all submissions (default 180)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    teams = load_teams(args.teams_file)
    client = ApiClient(args.base_url, args.http_timeout)

    try:
        client.request("GET", "/health", retries=1)
    except ApiError as exc:
        print(f"Backend not reachable at {args.base_url}: {exc}", file=sys.stderr)
        return 2

    rnd = detect_round(client)
    number, game, status = rnd.get("number", "?"), rnd["game"], rnd["status"]
    print(f"Current round: {number} ({game}), status: {status}")
    if status != "open":
        print("The round is not open, so nothing was submitted. This script never "
              "opens rounds; open it from the admin console and run again.", file=sys.stderr)
        return 2
    left = seconds_left(rnd)
    if left is not None:
        print(f"Round closes in {int(left)}s (server clock).")
        if left < args.poll_timeout:
            print("Warning: the round may close before checks finish.")

    prefix = GAME_PREFIX.get(game)
    if prefix is None:
        print(f"Unknown game '{game}': no bot prefix configured.", file=sys.stderr)
        return 2
    bots = list_bots(prefix)
    if not bots:
        print(f"No bots matching {prefix}*.py in {BOTS_DIR}.", file=sys.stderr)
        return 2

    # Spread bots across teams: team i gets bot i (wrapping if teams > bots).
    for i, team in enumerate(teams):
        team.bot = bots[i % len(bots)]

    for i, team in enumerate(teams):
        process_team(client, team, i, int(rnd["id"]))

    waiting = sum(t.outcome == "SUBMITTED" for t in teams)
    if waiting:
        print(f"\nWaiting for {waiting} submission(s) (timeout {args.poll_timeout:g}s)...")
        poll_submissions(client, teams, args.poll_interval, args.poll_timeout)

    print_summary(teams)
    # Rejected is a valid outcome; only teams with no terminal status are errors.
    return 0 if all(t.outcome in {"ACCEPTED", "REJECTED"} for t in teams) else 1


if __name__ == "__main__":
    sys.exit(main())
