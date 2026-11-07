# DEFCON Zero frontend: audit and plan

Session 0 (Foundation), 2026-11-07. Checked against `docs/api.md` **v5.3** and the backend on `origin/main` (`a2473bb`). v5.3's only change: `GET /rounds/current` is public. The local `docs/api.md` in this checkout is still v5.2 until this branch is rebased on main.
Tracks: **N** = Nithya (war map, spectator, organiser console). **S** = Siddharth (auth, claim, workspace).

Status key: **done** means it matches the contract and works. **partial** means it works but has gaps. **missing** means nothing calls the route. **inconsistent** means the frontend disagrees with the contract.

---

## 1. Endpoints and who uses them

| # | Endpoint | Frontend user | Status | Notes |
|---|---|---|---|---|
| 1 | `POST /auth/login` | `workspace/auth/Login.tsx` → `LoginOut` | partial | Works. The schema doesn't check `role`/`token_type` values. The mock sent a `team_id` for teams that haven't claimed; the contract says `null`. |
| 2 | `GET /me` | `Login.tsx` (after login), `lib/queries.useTeam` ← `App.useTeamSync` | inconsistent | `Team` schema had an invented `score` field, and the mock sent it. The schema leaves out `id`/`username`/`role`. The mock refused organisers (the contract answers them). |
| 3 | `POST /teams/claim` | `workspace/auth/ClaimCountry.tsx` | partial | Handles `TERRITORY_TAKEN`. Doesn't handle `ALREADY_CLAIMED` by re-reading `/me` and moving on to the workspace. The mock answered an unknown territory with 404 (should be 400) and didn't trim/collapse names. |
| 4 | `GET /territories` (public) | `queries.useTerritories` (claim); `warmap/WarMapPreview.tsx` uses raw `fetch` | partial | `name` was optional, with an `Intl` fallback; the contract says it's always present. The war map's own types (`warmap/types.ts`) don't have `name`. The mock required a login. |
| 5 | `GET /rounds` | — | missing | The organiser console needs it to find the id of the **next** round to open (the overview only names the current one). |
| 6 | `GET /rounds/current` (public, v5.3) | `queries.useCurrentRound` → header, `Workspace`, `OrganiserConsole`, `WarMapPreview`, `ConnectionStatus` | done (shared base) | Runs for every session, a token-less spectator included. 404 → `null` ("no round yet"). Before Session 0 the spectator sent a fake token. The mock required a login and always had round 1 open. |
| 7 | `POST /admin/rounds/{id}/open` | `OrganiserConsole` "Re-open (20m)" | inconsistent | Called on the **current** round, but the contract only allows it from `waiting`, so it always 409s after round 1 has opened. It should open the next `waiting` round (needs #5), with a chosen 1–240 `minutes`. |
| 8 | `POST /admin/rounds/{id}/extend` | `OrganiserConsole` +5 / +10 | partial | Raw `fetch`. Reads `err.detail`, which isn't the contract's error shape (`error.code`/`error.message`). |
| 9 | `POST /admin/rounds/{id}/start` | `OrganiserConsole` "Close window · Start matches" | partial | Raw `fetch`. No state shown for "matches playing in the background" or a run that failed. |
| 10 | `POST /admin/rounds/{id}/retry` | — | missing | Needed when a run fails and the round sits in `running`. |
| 11 | `POST /admin/rounds/{id}/publish` | `OrganiserConsole` "Publish results" | partial | Raw `fetch`. The confirm doesn't say who gets cut (top 15 / 8 / 2). It's offered in every status, though it's only valid in `review`. |
| 12 | `POST /submissions` | `Workspace.submitAgent` | done | Sends an Idempotency-Key and retries 5xx with the same key. The mock had no 403 for organisers / unclaimed / eliminated teams, no 422 for a reused key, and no 404 for an unknown round. |
| 13 | `GET /submissions?round_id=` | `queries.useSubmissions` → `SidePanels.History` | done | |
| 14 | `GET /submissions/{id}` | `queries.useSubmission`, Workspace restore/load | done | The schema now also reads `round_id` and `created_at`. |
| 15 | `GET /standings` (public) | `WarMapPreview` raw `fetch` | inconsistent | Not checked against the contract. Doesn't treat 404 as "no round yet". When `nations` is `[]` (nothing published yet) it **silently shows the scripted showcase data**. Reads a `movements` field that isn't in the contract. The mock had no `/standings` at all. |
| 16 | `PATCH /admin/teams/{id}` | `OrganiserConsole` Disqualify / Restore | partial | Raw `fetch`, wrong error reading. Only active ↔ disqualified, though any status can be set. |
| 17 | `GET /admin/overview` | `OrganiserConsole` raw `fetch` + hand-written interface | partial | Ignores `unclaimed`. A pending or running submission is shown as "rejected". The username is drawn as a status badge. The mock had no `/admin/*` routes. |
| 18 | `GET /health` (public) | — | missing (not needed) | `ConnectionStatus` reads the public `/rounds/current` for every role. `Health` schema exists in `contract.ts`, no hook. |

---

## 2. Gaps (in the contract, not covered yet)

- **Round lifecycle in the console:** open the next round (via `GET /rounds`), choose `minutes` (1–240), `retry`, a "matches playing…" / "run failed" state, and publish only in `review`. (N)
- **Admin overview fields:** the `unclaimed` list and the full submission status (`pending`/`running`/`accepted`/`rejected`). Scores are floats, so format them. (N)
- **"No round yet" (`/standings` 404) and "nothing published yet" (`nations: []`)** on the war map, instead of falling back to demo data. (N)
- **Team's own score:** `/me` has no score. A team reads its own score from the **public `GET /standings`**: find the row whose `team_id` is its own (published results only, absent until its first round is published). The shared hook `useStandings` is ready for this. (S)
- **`ALREADY_CLAIMED` / `NAME_TAKEN`** on claim: re-read `/me` and go to the workspace, or keep the selection and focus the name. (S)
- **Submit errors by code:** `FORBIDDEN` (eliminated/unclaimed), `TEAM_DISQUALIFIED`, `ROUND_NOT_OPEN`, `IDEMPOTENCY_KEY_REUSED`. Right now the server's message is shown as-is. (S)
- **Size limits:** `code` ≤ 65536 bytes and `blocks` ≤ 262144 bytes as JSON. Check `MAX_CODE_LENGTH` in `editor/drafts.ts` is in bytes, not characters. (S)

## 3. Inconsistencies (frontend disagrees with the contract)

Fixed in the shared base this session (see §6):
- `contract.ts`: invented `Team.score`. `role`/`status`/`game` were loose strings. `Territories.name` was optional. `/rounds`, `/standings` and `/admin/overview` had no schemas.
- The spectator pseudo-session sent a fake bearer token. Now it sends none, and calls the public `/rounds/current`, `/standings` and `/territories` like anyone else.
- The mock differed in about 15 places (listed under rows 1–17 above), and submission versions counted per round where the backend counts per team.

Still open (feature work in a track):
- `Workspace.tsx:663` reads `team.score`, which no longer exists on `/me` → S1.
- `WarMapPreview` / `OrganiserConsole` use raw `fetch` and their own hand-written types instead of `lib/api` + `lib/contract` → N1, N3.
- `warmap/types.ts` duplicates the contract (stale "draft v2", no `name`) and carries the provisional `TroopMovement` → N1.
- `OrganiserConsole` "Re-open" calls `open` on a non-`waiting` round → N3.

## 4. Requests to the backend (Sumedh). Nothing changed on our side.

1. ~~Make `GET /rounds/current` public.~~ **Done in v5.3** (`origin/main`, PR #16).
2. `TroopMovement` (`movements` on `/standings`) isn't in the contract. Either agree it with Sumedh or drop it from the live map (it can stay in the showcase loop).

---

## 5. End-to-end flow and where each piece lives

```
Login (workspace/auth/Login.tsx)
 ├─ "View Big Board" → spectator session (no token)
 │     └─ War map, public (warmap/WarMapPreview → WarMap)
 │          GET /rounds/current + GET /standings (2 s) + GET /territories, all public
 │
 ├─ team → GET /me
 │     ├─ team_id null → Claim nation (workspace/auth/ClaimCountry.tsx)
 │     │     GET /territories, POST /teams/claim → setTeam
 │     └─ claimed → Workspace (workspace/editor/Workspace.tsx), current round only
 │           GET /rounds/current (2 s) → game/editor/config chosen from `game`
 │           POST /submissions → poll GET /submissions/{id} → History / LatestResult
 │           eliminated / disqualified → "Nation fallen", no submit
 │
 └─ organiser → views: War map (with leaderboard) + Command Console
       Command Console (workspace/organiser/OrganiserConsole.tsx)
         GET /admin/overview (2–2.5 s), GET /rounds, open / extend / start / retry / publish,
         PATCH /admin/teams/{id}
```

Gating lives in `src/app/views.ts`: `viewsFor(session)` says which views a role may open, and `seesStandings(session)` says whether published standings may be shown. The App shell (`src/app/App.tsx`) only renders a view that `viewsFor` lists.

---

## 6. Shared base: what this session changes (step 3)

- `lib/contract.ts`: match v5.3 exactly. Strict fixed values. `Me` with `id`/`username`/`role`, no `score`. `Territories` with a required `name`. New `Rounds`, `Standings`, `AdminOverview`, the full `Submission` shape, and the error codes.
- `lib/auth.ts` / `lib/api.ts`: the spectator session sends no token and never logs out on a 401. `hasCode()` for branching on error codes.
- `lib/queries.ts`: `useCurrentRound` runs for everyone (public in v5.3). `useRounds` is login-only.
- `lib/queries.ts`: `useCurrentRound` only for team/organiser. New `useRounds`, `useStandings` (404 → null), `useAdminOverview`, plus a small typed `adminAction` helper.
- `app/views.ts`: `seesStandings` lets a spectator see published standings. The leaderboard panel itself is N2.
- `mock/server.mjs`: every v5.3 route with the contract's shapes, errors and transitions. Public routes need no token. Round 1 is open by default.
  - Demo data is opt-in. `MOCK_DEMO=1 npm run mock` adds 8 claimed demo teams with accepted round 1 versions plus 2 unclaimed accounts. `MOCK_DEMO=published` also plays and publishes round 1 and opens round 2. While running, `POST /__mock/demo {publish?}` does the same.
  - Control routes: `goto {index}` (`0` = no round started yet), `round`, `team`, `take`, `fail`, `reject`, `failrun` (the next match run fails, so `retry` can be tested), `submissions`, `expire`, `reset`.
- `mock/contract.test.ts` (new, runs with `npm test`): starts the mock and checks every route against the `contract.ts` schemas, walking a whole round. A drift between the mock and the contract now fails the unit tests.

---

## 7. Remaining work by track

### Track N (Nithya): war map, spectator, organiser console

> ⚠️ **Public leaderboard shows demo data until N1.** `views.ts` (`seesStandings`) is the single source for "spectator sees standings", and it already says yes. Until N1 lands, `WarMapPreview` fills the panel with scripted showcase standings whenever `GET /standings` has `nations: []` (i.e. before the first publish). There's deliberately no `App.tsx` override. **N1 is the first N task.**

- **N1 War map on live data.** Use `useStandings` / `useTerritories` from `lib/queries` (drop the raw `fetch` and the duplicate `warmap/types.ts` shapes). Show "no round yet" (404), "nothing published yet" (`[]`) and an error state. Never fall back to showcase data silently; showcase stays an explicit toggle. The spectator gets the full round (game, number, DEFCON, timer) from the public `useCurrentRound`. **Do this first:** since Session 0, `seesStandings` is true for spectators, so the existing panel already shows to the public board. Until N1, the panel falls back to scripted showcase standings when `nations` is `[]`.
  - *Later, optional (shared `lib/queries.ts`):* `useTerritoryList` keeps react-query's default 3 retries while `useCurrentRound`/`useStandings` use `retry: false`, so a `/territories`-only outage shows the war map's error/"signal lost" state ~7 s later than the others. Harmless; harmonise if wanted.
  - *Shared-file follow-up (ping Siddharth when it happens):* the final territory list is **42 codes**: US CA MX BR AR CL CO PE GB FR DE ES IT NL SE NO PL GR UA RU TR EG DZ MA NG KE ZA SA IR PK IN CN JP KR KZ ID TH VN PH AU + DK FI. All 42 checked against `warmap/worldPaths.ts` (N1 sub-step 5) and render. Sumedh swaps them into `backend/app/core/territories.py` (currently a temporary 21). Once that lands, update `TERRITORIES` in `mock/server.mjs` to match and rerun `npm test` (mock/contract.test.ts). Until then the mock's 21 match the backend, which is fine for testing.
- **N2 Public leaderboard.** Show it to spectators **only from published results**. While a round is `running` or `review`, it keeps the last published standings and is labelled as such (or hidden while running, as the projector prefers). Eliminated rows fade, disqualified rows are marked. Rank and score are floats from the server, never recomputed.
- **N3 Console on the contract.** Use `useAdminOverview` + `adminAction` (proper `error.code` handling, 409 `INVALID_ROUND_TRANSITION` explained). Buttons enabled by status: open next `waiting` round (`useRounds`) with a minutes input, extend (open), start (open), retry (running, failed run), publish (review, the confirm names the cut 15/8/2).
- **N4 Roster.** Show the `unclaimed` list, the full submission status, `passed/total`, the float score, and `PATCH` to any status with confirm and undo.
- **N5 Projector polish.** A full-screen spectator route/mode with no login form in the way. `ConnectionStatus` already works for the spectator (public `/rounds/current`).

### Track S (Siddharth): auth, claim, workspace
- **S1 Own score.** Replace `team.score` in `Workspace.tsx:663` with the team's own row from public `GET /standings` (`useStandings`, matched on `team_id`). "Not scored yet" when there's no row (nothing published yet, or 404 before any round). **Then delete the temporary `score?` field on the exported `Team` type in `lib/contract.ts` (marked "remove with S1").** It exists only so typecheck stays green until this task lands. The parsed `/me` never has a score.
- **S2 Login.** Branch on `INVALID_CREDENTIALS`. The spectator button creates the token-less spectator session (`SPECTATOR_SESSION` in `lib/auth`). Organisers skip the `/me` claim flow.
- **S3 Claim.** Handle `ALREADY_CLAIMED` (re-read `/me` → workspace) and `NAME_TAKEN` (keep the territory, focus the name). Unknown territory is now `400 VALIDATION_ERROR`. The name is trimmed/collapsed before checking (matches the server).
- **S4 Submit errors by code.** `ROUND_NOT_OPEN`, `TEAM_DISQUALIFIED`, `FORBIDDEN`, `IDEMPOTENCY_KEY_REUSED`, `VALIDATION_ERROR` (sizes: 64 KB code, 256 KB blocks).
- **S5 Round gating.** Verify the workspace handles `waiting`/`running`/`review`/`published` and "no round yet". Versions now count per team across rounds (as on the backend), so check any "version N" wording. `game` is now checked strictly (only the contract's three games), so a round with an unknown game fails to parse ("could not read"). **Rewrite or drop the Playwright test `a game this client has never heard of still gives a working editor`.** Change it to expect the "could not read" message, or remove it.

### Playwright (`e2e/team.spec.ts`) is stale. Split by area:
- **S, login/session:** `hammering Enter logs in once` and `an expired token…` (the button is now "Request Clearance"); `an organiser account gets a message…` (organisers now get the War map + Command Console, not a message); `a gateway error at login reads plainly`; `logging out returns to login…`.
- **S, claim:** every test in `claiming a country` (unknown territory is now 400; check the copy and button names).
- **S, workspace:** `submitting`, `the timer`, `the three rounds`, `blocks*`, `during the window`, `layout and wording`. Re-check selectors against the current UI. `a fallen team sees why` still uses `/__mock/team`.
- **S, contract guard:** `routes outside the contract are never called…`. Update its allow-list for `/standings`, `/rounds` and `/admin/*` if it runs as an organiser.
- **Knock-on effects of the Session 0 mock rewrite** (not yet run, expected to show up when the suite is revived):
  - `/__mock/take` now creates a real other team (`taker_<code>`), which appears in `/admin/overview` and on the map.
  - `/__mock/round {game: 'surprise'}` gives "could not read" (strict `game`, see S5).
  - Code with no strategy function is rejected with `Line 1: …`, so the editor marks line 1.
  - Versions count per team across rounds, so round 2's first version is not "Version 1" if round 1 had any.
  - Login and `/me` give `team_id: null` until the team claims, and the team id is created at claim.
  - Unknown territory is `400 VALIDATION_ERROR` (was 404).
  - Stored sessions from the old client are rejected, so users log in once more.
- **N, new:** no Playwright coverage yet for the war map, spectator or organiser console. Add specs for N1–N4 against the mock (`/__mock/demo` gives a populated board).
