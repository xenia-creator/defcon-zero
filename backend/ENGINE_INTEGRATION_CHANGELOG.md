# Backend and Engine-Integration Change Log

## Scope and baseline

This audit compares the current tree at `55d7015` with `4f615b2`, the parent
of the backend introduction commit `1750f17`. At that baseline,
`backend/README.md` was the only tracked backend file and was empty. There
were no backend application, schema, dependency, or configuration files.

The backend was introduced by `1750f17` (`Step 0.2: stub routes and contract
v3`). The later `55d7015` (`Implement Colonel Blotto and update engine
sandbox`) changed three backend files and updated the API contract. No files
were deleted in these changes. `backend/README.md` was not changed.

The entries below describe implementation and contract intent separately from
what actually runs: the introduced backend consists of static stubs and does
not invoke the engine.

## Backend files added

All files below were absent at `4f615b2`. “Why/how” describes the role each
addition was intended to serve in the backend API and the contract that fronts
the game engine.

| File | Contents and purpose |
|---|---|
| `backend/CLAUDE.md` | New backend development guidance: specifies FastAPI, the intended router/service/repository/model layering, error shape, the API contract as source of truth, and that the engine is a separate package to import rather than modify. It also names an intended future database/auth/test stack. It guides future integration but is not runtime configuration or implementation. |
| `backend/app/__init__.py` | Empty Python package marker, allowing imports under `app` and the documented `uvicorn app.main:app` entry point. |
| `backend/app/api/__init__.py` | Empty package marker for the HTTP API package. |
| `backend/app/api/v1/__init__.py` | Empty package marker for the group of version-1 routers. “v1” is an organization label only; no `/api/v1` URL prefix is applied. |
| `backend/app/api/v1/admin.py` | Adds `POST /admin/rounds/{round_id}/open` (`closes_at` body), `/extend` (`minutes` body), `/start` and `/publish`, plus `PATCH /admin/teams/{team_id}` (`status` body). Each returns a corresponding hardcoded round or team. These paths expose the organizer actions described by the API contract, but do not enforce organizer role, round transitions, or team updates. |
| `backend/app/api/v1/auth.py` | Adds `POST /auth/login` accepting username/password and returning a fake bearer-token response, and `GET /me` returning a fake team profile. These establish the contract’s auth/profile response shapes; credentials and authorization are not checked. |
| `backend/app/api/v1/health.py` | Adds public `GET /health`, returning `{"status":"ok"}`. This supports an API liveness check and the contract’s public health endpoint. |
| `backend/app/api/v1/rounds.py` | Adds `GET /rounds` (round collection plus server time) and `GET /rounds/current` (one round), both backed by static examples. These expose the game identifier and per-round configuration that a client needs to select a game/editor. |
| `backend/app/api/v1/router.py` | Creates the aggregate router and includes health, auth, teams, rounds, submissions, standings, and admin routers. It deliberately omits an `/api/v1` prefix so URLs match `docs/api.md`. |
| `backend/app/api/v1/standings.py` | Adds `GET /standings`, returning a static war-map standings response. |
| `backend/app/api/v1/stub_data.py` | Adds schema-constructed static responses for health, login, team, territories, rounds, submissions, and standings, with a frozen UTC server time. Its pending and accepted submission examples share an ID to illustrate the intended poll flow. The initial data used the then-current games and moves; `55d7015` later changed the examples to Prisoner’s Dilemma moves `AID`/`WITHHOLD`, a Blotto round and a Trust round. All data remains fake and is not updated per request. |
| `backend/app/api/v1/submissions.py` | Adds `POST /submissions` with a `SubmissionCreate` JSON body and optional `Idempotency-Key` header, returning HTTP 202 and a static pending submission; `GET /submissions?round_id=...`, returning static history; and `GET /submissions/{submission_id}`, returning a static accepted result. These shapes model the documented bot submission/check API, but the inputs and key are ignored and there is no compilation, engine execution, persistence, background check, or polling state. |
| `backend/app/api/v1/teams.py` | Adds `POST /teams/claim` with territory code and nation name, and `GET /territories`; both return static examples. No uniqueness or claim rules are implemented. |
| `backend/app/core/__init__.py` | Empty package marker for shared application infrastructure. |
| `backend/app/core/errors.py` | Adds `AppError`, a common `{"error":{"code":...,"message":...}}` response builder, request-validation mapping to HTTP 400 `VALIDATION_ERROR`, framework mappings for 400/404/405, and a middleware path that logs unexpected exceptions and returns HTTP 500 `INTERNAL_ERROR`. This aligns transport errors with the contract. Domain error codes can be raised through `AppError`, but the stub routes do not implement domain rules. |
| `backend/app/main.py` | Creates the FastAPI application, registers error handling, enables permissive wildcard CORS for all origins/methods/headers, and attaches the aggregate router. It is the ASGI application entry point. The wildcard origin is explicitly temporary in its comments and is not a production restriction. |
| `backend/app/schemas/__init__.py` | Empty package marker for Pydantic request/response models. |
| `backend/app/schemas/auth.py` | Defines login request (`username`, `password`) and response (`access_token`, bearer token type, `team`/`organiser` role, nullable `team_id`) models. These define the JSON contract; they do not authenticate anyone. |
| `backend/app/schemas/errors.py` | Defines the nested error response and detail (`code`, `message`) models used by shared error handling. |
| `backend/app/schemas/health.py` | Defines the health response with literal status `"ok"`. |
| `backend/app/schemas/rounds.py` | Defines game and round-status literals, `RoundConfig` (`moves`, `max_modules`, `block_limit`, `rounds_per_match`, `repetitions`), `Round` (IDs, game/status, nullable timezone-aware open/close times, config and server time), list response, and organizer open/extend request models. In `55d7015`, `Game` changed from `prisoners_dilemma | theatre_of_war | foreign_aid` to `prisoners_dilemma | blotto | trust`. |
| `backend/app/schemas/standings.py` | Defines each nation’s team/name/territory/status/score/rank and the response’s round ID/status, nation list and server time. |
| `backend/app/schemas/submissions.py` | Defines opaque Blockly `blocks.modules`, sample-bot results, check status/errors, full submission, create request, summary/history item, and list response. `modules` has a fixed schema maximum of three. In `55d7015`, sample scores changed from integer-only to `int | float` to permit fractional engine scores. The schema does not enforce per-round `max_modules` or `block_limit`. |
| `backend/app/schemas/teams.py` | Defines team profile, claim request, territory/list response, team status literal and status-update request. |
| `backend/requirements.txt` | Adds pinned runtime dependencies `fastapi==0.162.0`, `pydantic==2.14.3`, and `uvicorn==0.54.0`. No database, engine package, job queue, or environment/settings dependency is added. |

## Existing API documentation

`docs/api.md` existed before the backend application and was modified; it was
not newly created or deleted. At the backend baseline it was contract draft v2.
Changes before that baseline are part of the pre-integration contract history:

- `832a725` introduced v2 round `game`/`config`, Blockly `blocks`, idempotency
  semantics, and game-signature status.
- `33ef52f` unified the bot strategy signature, put move rules in
  `config.moves`, and renamed game keys.
- `3fd4610` confirmed the Prisoner’s Dilemma signature against the engine and
  marked other game signatures pending.

Those changes were already present in `4f615b2`; the restoration phase returns
the documentation to that pre-backend v2 state rather than undoing older
contract history.

`1750f17` then revised the existing contract from v2 to v3:

- Added public `GET /health` and exempted it, along with `POST /auth/login`,
  from the documented authorization requirement.
- Added HTTP 405 `METHOD_NOT_ALLOWED` to the documented error codes.
- Made `opens_at` and `closes_at` nullable for waiting rounds.
- Clarified that organizer login responses have `team_id: null`.
- Specified `PATCH /admin/teams/{id}` success as the same profile body as
  `GET /me`.

`55d7015` further revised the contract to match the engine/game changes:

- Changed the example Prisoner’s Dilemma moves from `C`/`D` to
  `AID`/`WITHHOLD`, and changed the example strategy’s first move accordingly.
- Replaced the listed `theatre_of_war` and `foreign_aid` games with `blotto`
  and `trust`; described Blotto as four non-negative integer troop counts
  summing to 10 and Trust as blocked pending approved rules.
- Clarified that Blotto returns an allocation list rather than one of the
  string values in `config.moves`.

No separate API-documentation file was added or deleted. `backend/CLAUDE.md`
was newly added as backend development guidance, not as the API contract.

## API routes and data contract represented by the backend

All successful examples use JSON. The API routers are attached without a
versioned path prefix. The added schemas describe these request and response
shapes:

| Route | Request | Response / behavior represented |
|---|---|---|
| `POST /auth/login` | `{"username": string, "password": string}` | 200: `access_token`, literal `token_type: "bearer"`, role (`team` or `organiser`), nullable `team_id`. |
| `GET /me` | None | 200: team profile: `id`, `username`, role, nullable `nation_name`/`territory_code`, and status (`active`, `eliminated`, `disqualified`). |
| `GET /health` | None; documented public | 200: `{"status":"ok"}`. |
| `POST /teams/claim` | `territory_code`, `nation_name` | 200: team profile. The contract documents conflict errors for taken territory/name and already-claimed team. |
| `GET /territories` | None | 200: `territories[]` with `territory_code`, `claimed`, nullable `nation_name`. |
| `GET /rounds` | None | 200: `rounds[]` and `server_time`. |
| `GET /rounds/current` | None | 200: one round; contract permits 404 when no round has started. |
| `POST /admin/rounds/{round_id}/open` | `{"closes_at": timezone-aware datetime}` | Updated round; contract allows transition from waiting. |
| `POST /admin/rounds/{round_id}/extend` | `{"minutes": positive integer}` | Updated round; contract allows transition from open. |
| `POST /admin/rounds/{round_id}/start` | No body | Updated round; contract allows transition from open. |
| `POST /admin/rounds/{round_id}/publish` | No body | Updated round; contract allows transition from review. |
| `PATCH /admin/teams/{team_id}` | `{"status": TeamStatus}` | 200 team profile. Documented as organizer-only. |
| `POST /submissions` | `round_id`, generated Python `code`, and `blocks: {"modules": [...]}`; optional `Idempotency-Key` header | 202: full `Submission` with `id`, `round_id`, `version`, status, creation time, code, blocks, nullable check, and server time. Contract describes background checking and 200 replay for a repeated key with the same body. |
| `GET /submissions?round_id={round_id}` | Required integer query parameter | 200: lightweight `submissions[]` (ID, version, status, creation time) plus server time. |
| `GET /submissions/{submission_id}` | Integer path parameter | 200: full submission, including code and blocks; contract restricts visibility to owning team/organizers. |
| `GET /standings` | None | 200: round ID/status, `nations[]` with team/name/territory/status/score/rank, and server time. |

The common documented error body is
`{"error":{"code": string, "message": string}}`. The contract lists validation
400, authentication 401, forbidden 403, not found 404, method not allowed
405, domain conflicts 409, idempotency-key reuse 422, and unexpected error
500. The implementation normalizes request validation and framework routing
errors, but most documented domain/auth errors have no corresponding checks
in the stub routes.

## Intended engine-facing flow versus implementation

The contract describes a client fetching a round, selecting the engine/editor
from `round.game`, and using `round.config` for move and Blockly limits. It
then submits generated Python plus the Blockly workspace. A submission is
intended to enter `pending`, be checked asynchronously against sample bots,
and be polled until accepted/rejected; accepted results contain test match
scores and engine opponent identifiers. The contract describes
`strategy(my_history, opp_history)` as the common signature; its current
game table documents Prisoner’s Dilemma string moves, a Blotto allocation
list, and Trust rules as unresolved.

The code does not perform that flow. No added backend file imports or calls
the engine. Route functions return fixed objects from `stub_data.py`; most
ignore their inputs. There is no persistence, strategy compilation,
sandboxing, engine match execution, background task, result mutation,
idempotency storage, auth/role enforcement, round state machine, territory
uniqueness logic, or team ownership check. For example, POST submission always
returns the same pending example while GET by ID always returns a static
accepted example. These are incomplete stubs, not a working engine adapter.

Other implementation/contract gaps visible in this snapshot:

- `RoundConfig` exposes module and block limits, but block count and the
  configured per-round module limit are not enforced; `Blocks.modules` only
  has a schema-level maximum of three.
- The Blotto contract describes an integer-array move, while `config.moves`
  and the schema are represented as `list[str]`; the fake config uses a
  descriptive string rather than machine-readable legal moves.
- `Idempotency-Key` is parsed but unused. The documented 200 replay and 422
  reused-key conflict are not implemented.
- `backend/CLAUDE.md` names a future PostgreSQL/SQLAlchemy/auth stack, but the
  requirements and code include none of those dependencies or configuration.
- CORS allows every origin and is marked temporary; no production settings
  or deployment configuration were introduced.

## File inventory and deletions

Added backend implementation/guidance files: the 25 paths listed in
“Backend files added.” Modified backend files after their introduction:
`backend/app/api/v1/stub_data.py`,
`backend/app/schemas/rounds.py`, and
`backend/app/schemas/submissions.py` (all by `55d7015`). The only existing API
documentation file modified was `docs/api.md`. No backend or API-documentation
files were deleted. The pre-existing empty `backend/README.md` was unchanged.

This changelog is the requested audit artifact; it was created before any
restoration. It is not an engine-integration implementation file.
