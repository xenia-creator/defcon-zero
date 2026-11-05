# DEFCON Zero API Contract

Status: draft v2. Changes from v1 are marked **[NEW]** or **[CHANGED]**.
Owner: Sumedh (backend). Engine signatures owned by Shashwat.

---

## 1. Conventions

- **Auth:** every route except `POST /auth/login` needs `Authorization: Bearer <token>`.
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
| 403 | `FORBIDDEN` | Logged in, but role not allowed (team calling an admin route) |
| 403 | `TEAM_DISQUALIFIED` | Disqualified team tries to submit |
| 404 | `NOT_FOUND` | Resource does not exist, or belongs to another team |
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

### `GET /me`

Response `200`:
```json
{
  "id": 7,
  "username": "team_kremlin",
  "role": "team",
  "nation_name": "Red Dawn",
  "territory_code": "RU",
  "status": "active"
}
```

`nation_name` and `territory_code` are `null` until claimed. `status` is `active`, `eliminated` or `disqualified`.

---

## 3. Territory claim

### `POST /teams/claim`

Request:
```json
{ "territory_code": "RU", "nation_name": "Red Dawn" }
```

Response `200`: same body as `GET /me`.

Errors: `409 TERRITORY_TAKEN`, `409 NAME_TAKEN`, `409 ALREADY_CLAIMED`. Uniqueness is enforced by database constraints, so two teams claiming at the same moment cannot both succeed.

### `GET /territories`

Response `200`:
```json
{
  "territories": [
    { "territory_code": "RU", "claimed": true, "nation_name": "Red Dawn" },
    { "territory_code": "BR", "claimed": false, "nation_name": null }
  ]
}
```

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
    "max_modules": 3,
    "block_limit": 40,
    "rounds_per_match": 200,
    "repetitions": 5
  },
  "server_time": "2026-11-12T10:12:03Z"
}
```

- **[NEW] `game`:** one of `prisoners_dilemma`, `blotto`, `trust`. **The frontend must choose the game, editor and docs from `game`, never from `number`.** `number` is for display only (DEFCON level).
- **[NEW] `config`:** per-round rules. The editor reads its limits from here instead of hardcoding them. Keys may differ per game; `max_modules` and `block_limit` are always present. Game-specific keys (for example `battlefields` and `troops` for Blotto) will be added once the engine signatures are confirmed.
- `status`: `waiting` → `open` → `running` → `review` → `published`.

### `GET /rounds`

Response `200`: `{ "rounds": [Round, ...], "server_time": "..." }`

### `GET /rounds/current`

Response `200`: a single Round object, or `404 NOT_FOUND` if no round has started.

### Organiser routes (role `organiser`, else `403 FORBIDDEN`)

| Route | Allowed from | Body |
|---|---|---|
| `POST /admin/rounds/{id}/open` | `waiting` | `{ "closes_at": "..." }` |
| `POST /admin/rounds/{id}/extend` | `open` | `{ "minutes": 10 }` |
| `POST /admin/rounds/{id}/start` | `open` | none |
| `POST /admin/rounds/{id}/publish` | `review` | none |

All return the updated Round object. Invalid transitions return `409 INVALID_ROUND_TRANSITION`.

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
- `check.error`: set when `rejected` (syntax error, timeout, invalid return value).
- `check.test_results`: results of test matches against sample bots. This replaces separate practice routes for now.
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

Response `202 Accepted`: the Submission object with `status: "pending"`, `check: null`.

The check runs in the background. Poll `GET /submissions/{id}` every 1 to 2 seconds until `status` is `accepted` or `rejected`.

**[NEW] Idempotency-Key**
- Generate one UUID per submit click. If the request fails or times out, retry with the **same** key.
- A repeated key with the same body returns the original submission (`200`) instead of creating a new version.
- A repeated key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.

Errors: `409 ROUND_NOT_OPEN`, `403 TEAM_DISQUALIFIED`, `400 VALIDATION_ERROR` (for example more than 3 modules).

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

---

## 7. Admin: teams

### `PATCH /admin/teams/{id}`

Organiser only.

```json
{ "status": "disqualified" }
```

There is no fair-play report route. Reports go to organisers directly, and organisers disqualify through this route.

---

## 8. Bot strategy signatures **[NEW, PENDING CONFIRMATION]**

> Owned by the engine (Shashwat). The engine is the source of truth: these signatures will be updated to match whatever the engine calls. **Do not build editor templates for Blotto or Trust until these are confirmed.**

| Game | Signature | Returns | Status |
|---|---|---|---|
| Prisoner's Dilemma | `strategy(my_history, opp_history)` | `"C"` or `"D"` | Matches current engine, to be confirmed |
| Theatre of War (Blotto) | TBC | TBC | Pending Shashwat |
| Foreign Aid (Trust) | TBC | TBC | Pending Shashwat |

`my_history` and `opp_history` are lists of previous moves, oldest first, empty on the first turn.

---

## 9. Not in scope for Monday

- Practice routes (covered by `check.test_results`)
- Fair-play reports
- WebSockets (polling for now)
- Redis job queue (submission checks run in-process for now; the API does not change when this moves to Redis)