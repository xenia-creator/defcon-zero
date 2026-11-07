# DEFCON Zero backend

The FastAPI server for DEFCON Zero: logins, territory claims, submissions, rounds
and standings. The API contract is `docs/api.md`.

This guide sets the backend up on a fresh Linux server. Every command runs from
the `backend` folder unless it says otherwise.

## 1. What the server needs

- **Python 3.14.** Check with `python3.14 --version`. If your distribution does not
  have it yet, install it from python.org or your distribution's backports.
- **PostgreSQL 18**, running on the same server or reachable from it.
- **The whole repository**, not only `backend/`. The game engine lives in
  `engine/`, next to `backend/`, and the backend imports it from there. It needs
  nothing beyond the Python standard library.

```bash
git clone <repo-url> defcon-zero
cd defcon-zero/backend
```

## 2. Database

Create a database user and two databases: `defcon` for the event, and
`defcon_test` for the tests. Put in a real password where it says so.

```bash
sudo -u postgres psql <<'SQL'
CREATE USER defcon_app WITH PASSWORD 'choose-a-real-password';
CREATE DATABASE defcon OWNER defcon_app;
CREATE DATABASE defcon_test OWNER defcon_app;
SQL
```

`defcon_test` is optional on the event server. You only need it to run the tests
there.

## 3. Python environment

A virtual environment (venv) keeps this project's packages apart from the
system's. Every versioned package is pinned in `requirements.txt`, so the server
runs the same code as development.

```bash
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run `source .venv/bin/activate` again in every new shell before the commands
below.

## 4. Settings: `backend/.env`

Settings are read from `backend/.env`. That file is never committed. Start from
the template:

```bash
cp .env.example .env
```

Then set:

| Setting | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql+asyncpg://defcon_app:<password>@localhost:5432/defcon`. The `+asyncpg` part is required: it tells SQLAlchemy which driver to use. |
| `JWT_SECRET` | yes | Signs login tokens. Generate one with `openssl rand -hex 32`, and never reuse the one from `.env.example`. If it changes, every logged-in user is logged out. |
| `CORS_ORIGINS` | on the event server | The browser addresses allowed to call the API, comma separated, with no trailing slash. If left out, it is the Vite dev server (`http://localhost:5173,http://127.0.0.1:5173`), which only suits local development. See the warning below. |
| `TEST_DATABASE_URL` | no | Only the tests use it. It must point at a database named `defcon_test`, because the tests wipe it, and they refuse to run against any other name. |

The server will not start if `DATABASE_URL` or `JWT_SECRET` is missing. It never
falls back to a default secret.

> **CORS_ORIGINS on event day.** It must contain the **exact address teams type
> into their browser** to open the frontend: scheme, host and port. For example:
>
> ```
> CORS_ORIGINS=http://192.168.1.10:5173
> ```
>
> `http://192.168.1.10:5173` and `http://localhost:5173` count as different
> origins, and so do `http` and `https`. If teams use more than one address, list
> each one, separated by commas. Restart the server after changing it.
>
> **If teams can see the app but every action fails (login, claim, submit), check
> this first.** The browser blocks every API response from an origin that is not
> on the list. In the browser console (F12) it shows as a CORS error.

## 5. Create the tables, rounds and accounts

```bash
# Create or update the tables. Safe to run again: it only applies new migrations.
alembic upgrade head

# Create the three rounds, all waiting. Safe to run again: existing rounds are skipped.
python -m scripts.create_rounds

# Create team and organiser accounts from a CSV file.
python -m scripts.create_users path/to/users.csv
```

Always use `python -m scripts.<name>`, not `python scripts/<name>.py`. The `-m`
form puts the backend folder on Python's import path. Every script prints the
name of the database it is using first, so check that it says `defcon`.

The CSV needs this header line and three columns:

```csv
username,password,role
team_kremlin,some-password,team
alice,another-password,organiser
```

- `role` is `team` or `organiser`.
- Usernames ignore case, and are stored in lowercase.
- The whole file is checked before anything is saved. A bad file saves nothing,
  and the errors give line numbers.
- Usernames that already exist are skipped and **keep their current password**.
  To change a password, use `set_password` (below).
- The CSV holds real passwords, so keep it off the server once the accounts exist.

To change an existing account's password:

```bash
python -m scripts.set_password alice
```

It prints the database name, then asks for the new password twice. Nothing you
type is shown, and the password is never printed. If the two entries differ,
nothing is changed. Usernames ignore case here too.

## 6. Run the tests

```bash
pytest
```

They need `TEST_DATABASE_URL` set to a database named `defcon_test`. They use a
real Postgres database and the real engine, and take about three minutes. They
create the tables in `defcon_test` themselves.

## 7. Run the server

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

- `--host 0.0.0.0` accepts connections from other machines, such as the lab's
  computers, not only from the server itself.
- **No `--reload`.** It is for development: it restarts the server whenever a
  file changes, and it runs the app in a second, child process.
- **Exactly one process.** No `--workers`, and never two copies at once, even
  behind a load balancer. The backend keeps some state in the server's memory
  and assumes it is the only server:
  - **Restart recovery.** At startup, the server picks up every submission check
    and every round that a previous run of the server left unfinished, and runs
    them again. A second process would see the first one's work as unfinished
    and run it a second time.
  - **The run guard.** What stops a round being played twice at once, for example
    after two quick `retry`s, is a list in memory (`RUNS_IN_PROGRESS` in
    `app/services/round_runs.py`). A second process has its own list, so it
    cannot see the first one's runs.
  - Submission checks also run inside the server process, not in a separate job
    queue.

Restarting the one server is safe, even in the middle of a round. Checks and
rounds that were cut off start again from the beginning at startup.

Check it is up with `curl http://localhost:8002/health`, which returns `{"status": "ok"}`.

## 8. Event day

Organisers use the organiser console in the frontend. Each button calls an
organiser route from `docs/api.md` section 4. The same routes work with curl,
using an organiser's token:

```bash
TOKEN=$(curl -s -X POST http://localhost:8002/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "alice", "password": "..."}' | python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])')

curl -X POST http://localhost:8002/admin/rounds/1/open \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"minutes": 45}'
```

### Event morning: wipe the dry run

Once the dry run is over, before the real event, in this order:

1. **Stop the server.** A running server may still be checking submissions or
   playing a round in the background, and would write rows straight back after
   the reset.
2. **Wipe the dry run, including its test team accounts:**

   ```bash
   python -m scripts.reset_event --yes --delete-team-accounts
   ```

   This deletes every match, standing, submission and team, and every account
   with role `team`, and sets every round back to `waiting`, with no times and no
   seed. Organiser accounts are kept. It prints the database name first, so check
   it says `defcon`. Without `--yes` it does nothing. There is no undo.

   (Without `--delete-team-accounts`, team accounts are kept and go back to
   unclaimed. Use that only if the dry run used the real team accounts.)
3. **Set a new password for every organiser.** The dry-run passwords have been
   shared with volunteers and typed on lab machines.

   ```bash
   python -m scripts.set_password alice
   python -m scripts.set_password bob
   ```

   A login token stays valid for 12 hours after it is issued, whatever the
   password does. If the dry run was less than 12 hours ago, also set a new
   `JWT_SECRET` (`openssl rand -hex 32`) in `.env`. That logs everyone out, so
   every old token stops working.
4. **Create the real team accounts:**

   ```bash
   python -m scripts.create_users real_users.csv
   ```

   Only list team accounts in it. Organisers that already exist are skipped and
   keep the password you just set.
5. **Start the server** (section 7). Before you do, check that `CORS_ORIGINS` is
   the address teams will type (section 4).

### Running each round

Rounds go in order, and only one is ever `open` or `running`. For each round:

1. **Open:** `POST /admin/rounds/{id}/open` with `{"minutes": 45}` (1 to 240).
   The submission window opens now and closes `minutes` from now. A round only
   opens once every earlier round is `published`.
2. **Extend** (if needed): `POST /admin/rounds/{id}/extend` with `{"minutes": 10}`
   adds time to the deadline while the round is `open`.
3. **Start:** `POST /admin/rounds/{id}/start` closes the window now and plays the
   matches in the background. Each team's latest accepted submission from before
   the deadline is the one that plays. The round shows `running`, then moves to
   `review` by itself once every match is stored. In `review`, the scores show
   in the organiser console, but stay hidden from `GET /standings` and the war
   map until publish.
4. **Retry** (only if the run failed): if the round stays `running` for much
   longer than usual, check the server log for `Run crashed for round`. Then call
   `POST /admin/rounds/{id}/retry`, which plays every match again from the
   beginning. It returns `409 INVALID_ROUND_TRANSITION` while the matches are
   still being played, so a run that is only slow is never started twice.
5. **Publish:** `POST /admin/rounds/{id}/publish` makes the results public on
   the war map and applies the cut in the same step: round 1 keeps the top 15,
   round 2 the top 8, and round 3 the top 2. Every other active team is
   eliminated. After round 3, rank 1 is the winner and rank 2 the runner-up.

To disqualify a team, use `PATCH /admin/teams/{id}` with
`{"status": "disqualified"}`. Do it before publish, and it drops to the bottom of
the round, so the cut still keeps the right number of teams. Setting it back to
`active` undoes a mistake.
