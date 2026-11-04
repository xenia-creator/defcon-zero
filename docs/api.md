# DEFCON Zero API contract

Base URL: `http://<server-ip>:8001/api/v1`
All requests and responses are JSON.
Logged in requests send the header `Authorization: Bearer <access_token>`.

## Identity

Each team has:
- a **nation name** they choose, shown everywhere: leaderboard, ticker, map labels
- a **territory**, a country shape on the map they claim, identified by a code like `BRA`

Both are unique. No two teams share a name or a territory.

## Errors

Every error uses this shape:

```json
{ "error": { "code": "TERRITORY_TAKEN", "message": "This territory is already claimed." } }
```

Frontend logic checks `code`. `message` is only for showing to the user.

| Code | Status | When |
| --- | --- | --- |
| `INVALID_LOGIN` | 401 | Wrong username or password |
| `UNAUTHORIZED` | 401 | Missing or expired token. Send the user to login |
| `FORBIDDEN` | 403 | Logged in, but not allowed, for example a team calling an admin route |
| `TERRITORY_TAKEN` | 409 | Territory already claimed |
| `NAME_TAKEN` | 409 | Nation name already used |
| `INVALID_NAME` | 422 | Name breaks the rules below |
| `ALREADY_CLAIMED` | 409 | This team has already claimed a territory |
| `WINDOW_CLOSED` | 403 | Submitting outside an open window |
| `INVALID_CODE` | 422 | Submission is not valid Python or has no `strategy` function |
| `NOT_FOUND` | 404 | The requested item does not exist |

## Live updates

For Monday the frontend **polls**: `GET /rounds/current` and `GET /standings` every 2 seconds. WebSockets come later.

---

## Auth

### POST /auth/login
Request:
```json
{ "username": "team07", "password": "secret" }
```
Response 200 for a team:
```json
{
  "access_token": "eyJhbGciOi...",
  "role": "team",
  "team": { "id": 7, "nation_name": null, "territory_code": null }
}
```
Response 200 for an organiser:
```json
{
  "access_token": "eyJhbGciOi...",
  "role": "organiser",
  "team": null
}
```
If `territory_code` is `null`, send the team to the claim screen.
If `team` is `null`, the user is an organiser: show the dashboard.
Errors: 401 `INVALID_LOGIN`

Accounts are created by organisers before the event. There is no sign up.

---

## Territories and nations

### GET /territories
Response 200:
```json
[
  { "code": "IND", "name": "India", "claimed": true },
  { "code": "BRA", "name": "Brazil", "claimed": false }
]
```
`name` is the real map name of the shape, for the picker only. Once claimed, the territory is shown with the team's nation name.

### POST /teams/me/claim
Request:
```json
{ "territory_code": "BRA", "nation_name": "Red Fox Republic" }
```
Response 200:
```json
{ "id": 7, "nation_name": "Red Fox Republic", "territory_code": "BRA" }
```
Nation name rules: 3 to 24 characters; letters, numbers and spaces only; unique, ignoring case.
A team claims once. Organisers can rename later.
Errors: 409 `TERRITORY_TAKEN`, 409 `NAME_TAKEN`, 422 `INVALID_NAME`, 409 `ALREADY_CLAIMED`

### GET /teams/me
Response 200:
```json
{ "id": 7, "nation_name": "Red Fox Republic", "territory_code": "BRA", "status": "alive" }
```
`status` is `alive`, `eliminated` or `disqualified`.

---

## Rounds

### GET /rounds/current
Response 200:
```json
{
  "id": 2,
  "number": 2,
  "name": "Theatre of War",
  "defcon": 2,
  "status": "open",
  "opens_at": "2026-11-20T10:00:00Z",
  "closes_at": "2026-11-20T10:45:00Z",
  "server_time": "2026-11-20T10:12:31Z"
}
```
`status` is `waiting`, `open`, `running`, `review` or `published`.
The timer is `closes_at - server_time`. Never use the browser's clock.

---

## Submissions

### POST /submissions
Request:
```json
{
  "code": "def strategy(state):\n    return \"C\"",
  "blocks": null
}
```
`blocks` is the Blockly layout as JSON, or `null` if written by hand.
Response 202:
```json
{ "id": 41, "version": 3, "status": "pending" }
```
Errors: 403 `WINDOW_CLOSED`, 422 `INVALID_CODE`

### GET /submissions/{id}
Response 200, once checked:
```json
{
  "id": 41,
  "version": 3,
  "status": "accepted",
  "errors": [],
  "test_results": [
    { "opponent": "tit_for_tat", "my_score": 600, "opp_score": 600 },
    { "opponent": "always_defect", "my_score": 199, "opp_score": 204 }
  ]
}
```
`status` is `pending`, `accepted` or `rejected`. Poll every second while `pending`.
When `rejected`, `errors` holds messages like `"Line 3: importing 'os' is not allowed."`
A team can only read its own submissions.

### GET /submissions
Response 200: the team's versions, newest first.
```json
[ { "id": 41, "version": 3, "status": "accepted", "created_at": "2026-11-20T10:10:02Z" } ]
```

---

## Standings: the war map reads this

### GET /standings
Response 200:
```json
{
  "round_id": 2,
  "published": true,
  "nations": [
    { "rank": 1, "team_id": 7, "nation_name": "Red Fox Republic", "territory_code": "BRA", "score": 26864, "status": "alive" },
    { "rank": 9, "team_id": 3, "nation_name": "Frost Union", "territory_code": "JPN", "score": 21004, "status": "eliminated" }
  ]
}
```
The map lights up `alive` territories, fades `eliminated` and `disqualified` ones, and labels each with its `nation_name`.
Use `team_id` to highlight the logged in team's own row.

---

## Organiser only

Requires an account with `role: organiser`. Team accounts get 403 `FORBIDDEN`.

| Method and path | Body | Does |
| --- | --- | --- |
| POST /admin/rounds/{id}/open | none | Opens the submission window |
| POST /admin/rounds/{id}/start | none | Locks submissions and runs all matches |
| POST /admin/rounds/{id}/publish | none | Publishes standings and applies the cut |
| POST /admin/rounds/{id}/extend | `{ "minutes": 5 }` | Extends the window |
| POST /admin/teams/{id}/rename | `{ "nation_name": "New Name" }` | Renames a nation. Same name rules and errors as claiming |

---

## Health

### GET /health
Response 200: `{ "status": "ok" }`