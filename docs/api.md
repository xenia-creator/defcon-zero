# DEFCON Zero API Contract

Status: draft v5.2. Changes in v5.2 are marked **[v5.2]**, changes in v5.1 are marked **[v5.1]**, and changes in v5 are marked **[v5]**. Older **[v4]** markers are from v4, and **[NEW]** and **[CHANGED]** markers are from v3.
Owner: Sumedh (backend). Engine signatures owned by Shashwat.

Changelog:
- v5.2: `POST /admin/rounds/{id}/retry` added, to rerun a round's matches after a failed run. `start` now plays the matches in the background, and the round moves to `review` when they are stored. `GET /standings` only shows published results, and its ranking rules are written down in section 6.
- v5.1: The engine now supports all three games, so `not available yet` is gone. `check.test_results` has one entry per sample bot, and a bot that fails during a match is `rejected` with its `test_results` still included. Example `opponent` values corrected.
- v5: Final rules for all three games in section 8. `config.moves` is empty for `theatre_of_war` and `foreign_aid`. `config` gains `troops` and `regions` for `theatre_of_war`, and `endowment` and `multiplier` for `foreign_aid`. Scoring for Theatre of War and Foreign Aid added. All scores are floats. `POST /admin/rounds/{id}/open` takes `minutes` instead of `closes_at`, `minutes` must be 1 to 240, and rounds must open in order. `POST /submissions` limits `code`, `blocks` and `Idempotency-Key` sizes and lists more errors. The server checks `max_modules` but not `block_limit`. `check.test_results` stays empty until the new engine version lands.
- v4: `GET /territories` returns a `name` for each territory. Nation name rules added to `POST /teams/claim`. `team_id` is also `null` for teams that have not claimed yet. `GET /me` gains `team_id`, and its `id` is confirmed as the user id. Usernames are case-insensitive.

---

## 1. Conventions

- **Auth:** every route except `POST /auth/login` and `GET /health` needs `Authorization: Bearer <token>`. **[CHANGED]**
- **Timestamps:** ISO 8601, UTC, for example `2026-11-12T10:30:00Z`.
- **server_time:** every round and submission response includes `server_time`. Timers on the frontend must be computed as `closes_at - server_time`, never from the client clock.
- **IDs:** integers.
- **Content type:** `application/json` for all requests and responses.

### Error shape (every error, every route)

```json
{
  "error": {
    "code": "TERRITORY_TAKEN",
    "message": "This territory has already been claimed."
  }
}
```

The frontend should branch on `code`, never on `message`. Messages may change; codes will not.

### Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or params fail validation |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired token |
| 401 | `INVALID_CREDENTIALS` | Wrong username or password at login |
| 403 | `FORBIDDEN` | Logged in, but not allowed (team calling an admin route, or an organiser, unclaimed team or eliminated team submitting) **[v5]** |
| 403 | `TEAM_DISQUALIFIED` | Disqualified team tries to submit |
| 404 | `NOT_FOUND` | Resource does not exist, or belongs to another team |
| 405 | `METHOD_NOT_ALLOWED` | The route exists, but not with this HTTP method **[NEW]** |
| 409 | `TERRITORY_TAKEN` | Territory already claimed |
| 409 | `NAME_TAKEN` | Nation name already claimed |
| 409 | `ALREADY_CLAIMED` | Team has already claimed a territory |
| 409 | `ROUND_NOT_OPEN` | Submitting when the round is not `open` or the deadline has passed |
| 409 | `INVALID_ROUND_TRANSITION` | Organiser action not allowed from the current status |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Same Idempotency-Key sent with a different body |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

Note: another team's submission returns **404, not 403**, so the API does not reveal that it exists.

---

## 2. Auth

### `POST /auth/login`

Request:
```json
{ "username": "team_kremlin", "password": "..." }
```

Response `200`:
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "role": "team",
  "team_id": 7
}
```

`role` is `"team"` or `"organiser"`. Organiser accounts are created by the backend team only. Errors: `401 INVALID_CREDENTIALS`.

**[v4]** Usernames are case-insensitive: they are stored in lowercase, and `Team_Kremlin` logs in to the `team_kremlin` account.

**[v4]** `team_id` is `null` for organisers and for teams that have not claimed yet.

### `GET /me`

Response `200`:
```json
{
  "id": 12,
  "team_id": 7,
  "username": "team_kremlin",
  "role": "team",
  "nation_name": "Red Dawn",
  "territory_code": "RU",
  "status": "active"
}
```

**[v4]** `id` is the user id. `team_id` is the team id, and is `null` for organisers and for teams that have not claimed yet.

`nation_name` and `territory_code` are `null` until claimed. `status` is `active`, `eliminated` or `disqualified`. **[v4]** A team that has not claimed yet has `status` `active`. Organisers have no team, so they get `team_id`, `nation_name` and `territory_code` as `null` and `status` `active`.

---

## 3. Territory claim

### `POST /teams/claim`

Request:
```json
{ "territory_code": "RU", "nation_name": "Red Dawn" }
```

**[v4]** `nation_name` rules:
- The server first trims spaces from both ends and collapses repeated spaces into one. The rules below apply to the cleaned name, and the cleaned name is what is stored and returned.
- 3 to 24 characters.
- Only A-Z (either case), 0-9 and spaces. No accented letters.
- At least one letter.
- Unique ignoring case, so `Red Dawn` and `RED DAWN` cannot both exist.

Response `200`: same body as `GET /me`.

Errors: `400 VALIDATION_ERROR` (name breaks the rules above, or `territory_code` is not a known territory) **[v4]**, `403 FORBIDDEN` (organisers cannot claim) **[v4]**, `409 TERRITORY_TAKEN`, `409 NAME_TAKEN`, `409 ALREADY_CLAIMED`. Uniqueness is enforced by database constraints, so two teams claiming at the same moment cannot both succeed.

### `GET /territories` **[v4]**

Response `200`:
```json
{
  "territories": [
    { "territory_code": "RU", "name": "Russia", "claimed": true, "nation_name": "Red Dawn" },
    { "territory_code": "BR", "name": "Brazil", "claimed": false, "nation_name": null }
  ]
}
```

- **[v4] `name`:** the territory's display name. Always present. `nation_name` is the name the team chose, and stays `null` until claimed.

---

## 4. Rounds

### Round object **[CHANGED]**

```json
{
  "id": 1,
  "number": 1,
  "game": "prisoners_dilemma",
  "status": "open",
  "opens_at": "2026-11-12T10:00:00Z",
  "closes_at": "2026-11-12T10:45:00Z",
  "config": {
    "moves": ["C", "D"],
    "max_modules": 3,
    "block_limit": 40,
    "rounds_per_match": 200,
    "repetitions": 5
  },
  "server_time": "2026-11-12T10:12:03Z"
}
```

- **[CHANGED] `opens_at`, `closes_at`:** nullable while `status` is `waiting`.
- **[NEW] `game`:** one of `prisoners_dilemma`, `theatre_of_war`, `foreign_aid`. **The frontend must choose the game, editor and docs from `game`, never from `number`.** `number` is for display only (DEFCON level).
- **[NEW] `config`:** per-round rules. The editor reads its limits and move blocks from here instead of hardcoding them.
  - **[v5]** `moves`: `["C", "D"]` for `prisoners_dilemma`, and an empty list for the other games, whose moves are numbers rather than fixed choices (see section 8).
  - `max_modules`: maximum Blockly modules per submission.
  - `block_limit`: maximum blocks per submission. **[v5]** Enforced by the frontend only: the server checks `max_modules` and does not count blocks.
  - `rounds_per_match`, `repetitions`: match settings, shown for information.
  - **[v5]** `troops`, `regions`: `theatre_of_war` only, and absent for other games. `troops` is 100 and `regions` is 5.
  - **[v5]** `endowment`, `multiplier`: `foreign_aid` only, and absent for other games. `endowment` is 10 and `multiplier` is 3.
- `status`: `waiting` → `open` → `running` → `review` → `published`.

### `GET /rounds`

Response `200`: `{ "rounds": [Round, ...], "server_time": "..." }`

### `GET /rounds/current`

Response `200`: a single Round object, or `404 NOT_FOUND` if no round has started.

### Organiser routes (role `organiser`, else `403 FORBIDDEN`)

| Route | Allowed from | Body |
|---|---|---|
| `POST /admin/rounds/{id}/open` | `waiting` | `{ "minutes": 45 }` **[v5]** |
| `POST /admin/rounds/{id}/extend` | `open` | `{ "minutes": 10 }` |
| `POST /admin/rounds/{id}/start` | `open` | none |
| `POST /admin/rounds/{id}/retry` **[v5.2]** | `running` | none |
| `POST /admin/rounds/{id}/publish` | `review` | none |

All return the updated Round object. Invalid transitions return `409 INVALID_ROUND_TRANSITION`.

**[v5]** `open` sets `opens_at` to now and `closes_at` to now plus `minutes`. `extend` adds `minutes` to `closes_at`. `start` sets `closes_at` to now, which closes the window.

**[v5.2]** After `start`, the matches play in the background and the round stays `running` until every match is stored, then moves to `review` by itself. Poll `GET /rounds/current` to see it change. If the run fails, the round stays `running`, and `retry` plays the matches again from the beginning. `retry` returns `409 INVALID_ROUND_TRANSITION` if the round is not `running`, or if its matches are still being played.

**[v5]** `minutes` must be 1 to 240, otherwise `400 VALIDATION_ERROR`.

**[v5]** Rounds go in order: a round can only open if every lower-numbered round is `published`, otherwise `409 INVALID_ROUND_TRANSITION`. So only one round is ever `open` or `running`.

---

## 5. Submissions

### Submission object **[CHANGED]**

```json
{
  "id": 42,
  "round_id": 1,
  "version": 4,
  "status": "accepted",
  "created_at": "2026-11-12T10:20:11Z",
  "code": "def strategy(my_history, opp_history):\n    ...",
  "blocks": {
    "modules": [ { "...": "Blockly workspace JSON" } ]
  },
  "check": {
    "error": null,
    "test_results": [
      { "opponent": "always_cooperate", "my_score": 600, "opp_score": 0 },
      { "opponent": "tit_for_tat", "my_score": 600, "opp_score": 600 }
    ]
  },
  "server_time": "2026-11-12T10:20:15Z"
}
```

- **[NEW] `blocks`:** the Blockly workspace JSON, stored alongside the generated Python so old versions can be reopened in the editor. Python cannot be converted back into blocks, so both are stored. `modules` holds at most `config.max_modules` items (3), validated on the server.
- `status`: `pending` → `running` → `accepted` or `rejected`.
- `check.error`: set when `rejected` (syntax error, timeout, invalid move).
- `check.test_results`: results of test matches against sample bots. This replaces separate practice routes for now. **[v5.1]** It has one entry per sample bot for the round's game. It is empty when the code never ran, for example a syntax error. A bot that fails during a match is `rejected`, and its `test_results` are still included.
- **[NEW]** `check.test_results[].opponent` is the engine identifier of the sample bot, for example `tit_for_tat`, `even_split`, `always_send_0_return_0`. **[v5.1]**
- Submissions are **never overwritten**; every submit creates a new version.
- **The latest `accepted` submission created before `closes_at` is the one that plays.**

### `POST /submissions` **[CHANGED]**

Headers:
```
Authorization: Bearer <token>
Idempotency-Key: 3f6c1a9e-8b2d-4c71-9a0e-5d2f8b1c7e44     (optional, recommended)
```

Request:
```json
{
  "round_id": 1,
  "code": "def strategy(my_history, opp_history):\n    ...",
  "blocks": { "modules": [ ... ] }
}
```

**[v5]** `code` can be at most 64 KB (65536 bytes), and `blocks` at most 256 KB (262144 bytes) as JSON. Anything bigger is a `400 VALIDATION_ERROR`. `Idempotency-Key` can be 1 to 255 characters.

Response `202 Accepted`: the Submission object with `status: "pending"`, `check: null`.

The check runs in the background. Poll `GET /submissions/{id}` every 1 to 2 seconds until `status` is `accepted` or `rejected`.

**[NEW] Idempotency-Key**
- Generate one UUID per submit click. If the request fails or times out, retry with the **same** key.
- A repeated key with the same body returns the original submission (`200`) instead of creating a new version.
- A repeated key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.

Errors: `409 ROUND_NOT_OPEN`, `403 TEAM_DISQUALIFIED`, `400 VALIDATION_ERROR` (for example more than 3 modules), `403 FORBIDDEN` (organisers, teams that have not claimed, and eliminated teams) **[v5]**, `404 NOT_FOUND` (no such round) **[v5]**.

### `GET /submissions?round_id=1`

Own team only. Lightweight list for a version history view; `code` and `blocks` are omitted.

```json
{
  "submissions": [
    { "id": 42, "version": 4, "status": "accepted", "created_at": "..." },
    { "id": 39, "version": 3, "status": "rejected", "created_at": "..." }
  ],
  "server_time": "..."
}
```

### `GET /submissions/{id}` **[CHANGED]**

Full Submission object **including `code` and `blocks`**.

Visible to the owning team and organisers only. Any other team gets `404 NOT_FOUND`.

---

## 6. Standings (war map)

### `GET /standings`

Polled by the war map every 2 seconds. WebSockets will replace polling later without changing this shape.

```json
{
  "round_id": 1,
  "round_status": "published",
  "nations": [
    {
      "team_id": 7,
      "nation_name": "Red Dawn",
      "territory_code": "RU",
      "status": "active",
      "score": 3120,
      "rank": 1
    }
  ],
  "server_time": "..."
}
```

`status` drives the map: `active` shows normally, `eliminated` fades out, `disqualified` is shown as disqualified.

**[v5.2]** Rules:
- `round_id` and `round_status` are the current round, the same one as `GET /rounds/current`. Before any round has started, this returns `404 NOT_FOUND`.
- **Results stay private until published.** `score` and `rank` only ever come from `published` rounds. While a round is `running` or in `review`, `nations` keeps showing the last published results. Organisers see the new scores through `GET /admin/overview`.
- Each nation shows its result from the latest published round it played. A nation knocked out in round 1 keeps its round 1 `score` and `rank`. A nation with no published result yet is left out, so `nations` is `[]` until the first round is published.
- `status` is always the team's status now, so a disqualification shows at once.
- `nations` is sorted by `rank`, best first.
- `rank` is a position, 1 to N, with no equal ranks. Within a round:
  1. Teams that played, by total score. Teams on the same score are ordered by head-to-head wins against each other, then by a seeded draw.
  2. Teams with no accepted submission, with score 0.
  3. Teams disqualified during the round, with score 0.
- A round's score is the sum of the team's match scores. Matches with a bot that failed during the round do not count, so every remaining team is scored on the same opponents.

---

## 7. Admin: teams

### `PATCH /admin/teams/{id}`

Organiser only.

```json
{ "status": "disqualified" }
```

**[CHANGED]** Response `200`: same body as `GET /me`.

**[v4]** `{id}` in the URL is the team id, which matches `team_id` in the response. `id` in the response is the user id.

There is no fair-play report route. Reports go to organisers directly, and organisers disqualify through this route.

---

## 8. Bot strategy signatures **[NEW]**

**[v5]** All games use the same signature. What counts as a move differs by game.

    strategy(my_history, opp_history) -> move

| Game | `game` key | A move is | `config.moves` | Status |
|---|---|---|---|---|
| Prisoner's Dilemma | `prisoners_dilemma` | `"C"` or `"D"` | `["C", "D"]` | Confirmed against engine |
| Theatre of War | `theatre_of_war` | A list of 5 whole numbers, none negative, summing to 100 | `[]` | Confirmed against engine **[v5.1]** |
| Foreign Aid | `foreign_aid` | A whole number, with a range set by the bot's role | `[]` | Confirmed against engine **[v5.1]** |

`my_history` and `opp_history` are lists of previous moves, oldest first. Both are empty on the first turn, except for the receiving bot in Foreign Aid (see below). Returning anything that breaks the game's rules is an invalid move.

**[v5] Scores:** all scores are floats in every game, since Theatre of War gives half points. This covers `my_score` and `opp_score` in `check.test_results` (section 5) and `score` in `GET /standings` (section 6).

**[v5.1]** All three games are in the engine, so a submission is checked for whichever game its round uses.

### Prisoner's Dilemma

```python
def strategy(my_history, opp_history):
    # Tit for Tat: cooperate first, then copy the opponent's last move
    return opp_history[-1] if opp_history else "C"
```

### Theatre of War **[v5]**

A bot returns a list of `config.regions` (5) whole numbers, none negative, summing to `config.troops` (100). Each history is a list of previous allocations.

Scoring: in each region, the bot with more troops wins that region, and a tied region counts as half a region to each bot. Each turn, the bot with more regions gets 1 point, and if both have the same number they get 0.5 each. The match score is the sum over all turns.

```python
def strategy(my_history, opp_history):
    # Spread the troops evenly across all 5 regions
    return [20, 20, 20, 20, 20]
```

### Foreign Aid **[v5]**

This is the Trust Game, and every amount is a whole number. Roles alternate: the first bot sends on even turns, counting from 0, and the second bot sends on odd turns. A bot works out its role from the history lengths:

| Condition | Role | Must return |
|---|---|---|
| `len(opp_history) == len(my_history)` | Sending | 0 to `config.endowment` (10) |
| `len(opp_history) > len(my_history)` | Receiving | 0 to `config.multiplier` (3) times `opp_history[-1]` |

When receiving, `opp_history[-1]` is the amount just sent, and the bot received 3 times that amount.

Scoring: each turn, the sender scores `10 - sent + returned` and the receiver scores `3 * sent - returned`. The match score is the sum over all turns.

```python
def strategy(my_history, opp_history):
    if len(opp_history) == len(my_history):
        # Sending: offer half of the endowment of 10
        return 5
    # Receiving: return the amount sent, keeping the rest of the 3 times received
    return opp_history[-1]
```

---

## 9. Not in scope for Monday

- Practice routes (covered by `check.test_results`)
- Fair-play reports
- WebSockets (polling for now)
- Redis job queue (submission checks run in-process for now; the API does not change when this moves to Redis)

---

## 10. Health **[NEW]**

### `GET /health`

Public route: no token needed.

Response `200`:
```json
{ "status": "ok" }
```