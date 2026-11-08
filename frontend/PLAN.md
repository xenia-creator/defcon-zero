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
  - *Keep in sync:* the 42 territory codes live in both `src/warmap/palette.ts` (`TERRITORY_CODES`, for the neighbour-aware colours) and `mock/server.mjs` (`TERRITORIES`). Change one, change the other.
- **N3 Console on the contract — done (Sumedh, covering for Nithya).** `OrganiserConsole.tsx` reads only `useAdminOverview` (no raw `fetch`, no hand-written types, no made-up fallbacks: no data, no buttons) and acts through `admin.*` + `useRefreshAfterAdmin` (refetch after every action, success or failure). Allowed actions come from the pure `workspace/organiser/actions.ts` (`allowedActions`, unit-tested): waiting → Open (1–240 min, default 45); open → Extend (default 10), Start (confirm); running → "Matches playing…" + Retry (confirm, always shown: the contract has no run-failed flag); review → Publish (confirm names the cut from `TEAMS_KEPT_BY_ROUND_NUMBER`, 15/8/2, which must match `backend/app/core/rounds.py`); published → open the next `waiting` round found via `useRounds` (`nextRound`), or "Tournament complete" after round 3. Re-open and the fixed +5/+10 are gone. Timer = `closes_at` against server time synced from the overview's `server_time` (`lib/clock`). Errors by code (`actionErrorMessage`, `hasCode`): `INVALID_ROUND_TRANSITION` gets a plain explanation (Retry: "Matches are still playing…"), everything else the server message; shown as a toast and kept in the panel until a round action succeeds. One request at a time. States: loading, load error with Retry, 404 "No rounds created yet", and a failed poll keeps the last good data with a notice. Mock-only controls render only under `USE_MOCK_API`. Roster moved onto `admin.setTeamStatus` + contract types with its UI unchanged (N4). Covered by `e2e/organiser.spec.ts`.
- **N4 Roster — done (Sumedh, covering for Nithya).** The roster is its own table (`workspace/organiser/RosterTable.tsx`), driven by pure, unit-tested logic in `workspace/organiser/roster.ts`. Columns: nation, territory, username (plain text), status (badge), submission, score; `is_bot` is ignored everywhere, telemetry included. `submissionLabel`: "No submission", "Checking…" while pending/running (never "0 / 0"), else status · v{n} · passed {p} / {t} (left out when total is 0) · local HH:MM:SS. `formatScore`: at most 2 decimals, no separators. `sortTeams`: by score in review/published, labelled "Sorted by score" (never "rank", ties keep the server order), otherwise the server's username order; disqualified always last. Search (nation or username, any case), status filter, and a count ("8 teams" / "1 of 8 teams"). An Unclaimed Accounts panel lists `unclaimed` with a count, or "All accounts claimed". `rowAction`: active → Disqualify, disqualified → Restore, eliminated → nothing (eliminated only comes from publish). Both confirm with `confirmText`, worded for the round's status (Restore in waiting/open/running: "They become active again."). Errors by code (`rowErrorMessage`: `FORBIDDEN` → "Not an organiser", `NOT_FOUND` → "Team no longer exists, refresh", else the server message) show in the row and as a toast, and clear on that row's next success. Each row has its own in-flight guard, separate from the round actions; everything is refetched after each action. Layout: the roster is full width under Round Control and Telemetry; "Total Nations" tile removed (it equalled Teams). Covered by `e2e/organiser.spec.ts`. The two leftovers for the beautification pass are done in §8: the `active` badge has a khaki tone in `ui.tsx`, and the `App.tsx` header wraps at phone width.
- **N5 Projector polish.** A full-screen spectator route/mode with no login form in the way. `ConnectionStatus` already works for the spectator (public `/rounds/current`).

### Track S (Siddharth): auth, claim, workspace
- **S1 Own score — done (#25).** Replaced `team.score` in `Workspace.tsx` with the team's own row from public `GET /standings` (`useStandings`, matched on `team_id`), showing "Not scored yet" when there's no row (nothing published yet, or 404 before any round), and deleted the temporary `score?` field on `Team` in `lib/contract.ts`.
- **S2 Login — done (#25).** Branched on `INVALID_CREDENTIALS`, fixed `<p role="alert">` visibility, wired the spectator button to `SPECTATOR_SESSION` in `lib/auth`, and skipped the `/me` claim flow for organisers.
- **S3 Claim — done (#25).** Handled `ALREADY_CLAIMED` (re-reads `/me` → workspace) and `NAME_TAKEN` (keeps the territory, focuses the name), plus `cleanNationName` trimming and space collapsing before checking and sending.
- **S4 Submit errors by code — done (#25).** Handled `ROUND_NOT_OPEN`, `TEAM_DISQUALIFIED`, `FORBIDDEN`, `IDEMPOTENCY_KEY_REUSED`, and `VALIDATION_ERROR`, and enforced UTF-8 byte limits (`65536` bytes for `code`, `262144` bytes for `blocks`).
- **S5 Round gating — done (#25).** Verified workspace handling of `waiting`/`running`/`review`/`published` and "no round yet", surfaced `BAD_RESPONSE` alert when a round has an unknown `game`, and updated the Playwright test `a game this client has never heard of reports a could-not-read error`.

### Playwright (`e2e/team.spec.ts`) is stale. Split by area:
- **S, login/session — done (#25, S3):** `hammering Enter logs in once` and `an expired token…` (the button is now "Request Clearance"); `an organiser account gets the war map and command console, not a team screen`; `a gateway error at login reads plainly`; `logging out returns to login…`; spectator button session test.
- **S, claim — done (#25, S3):** every test in `claiming a country` updated for "Lock in", `NAME_TAKEN` focus, and `ALREADY_CLAIMED` `/me` recovery.
- **S, workspace — done (#25, S3):** `submitting`, `the timer`, `the three rounds` (Round 2 troop map, Round 3 trust game, strict unknown-game error), `blocks for round 1`, `during the window`, `layout and wording` all green (67/67 passed).
- **S, contract guard — done (#25, S3):** `routes outside the contract are never called…` passes.
- **Knock-on effects of the Session 0 mock rewrite** (not yet run, expected to show up when the suite is revived):
  - `/__mock/take` now creates a real other team (`taker_<code>`), which appears in `/admin/overview` and on the map.
  - `/__mock/round {game: 'surprise'}` gives "could not read" (strict `game`, see S5).
  - Code with no strategy function is rejected with `Line 1: …`, so the editor marks line 1.
  - Versions count per team across rounds, so round 2's first version is not "Version 1" if round 1 had any.
  - Login and `/me` give `team_id: null` until the team claims, and the team id is created at claim.
  - Unknown territory is `400 VALIDATION_ERROR` (was 404).
  - Stored sessions from the old client are rejected, so users log in once more.
- **N, new:** the organiser console is covered by `e2e/organiser.spec.ts` (N3: transitions, confirms, errors by code, states; N4: roster labels, order, search and filter, unclaimed accounts, disqualify/restore confirms, row errors, per-row busy). Still no Playwright coverage for the war map or spectator. Add specs for N1 and N2 against the mock (`/__mock/demo` gives a populated board).

## 8. First visual pass (branch `look/first-pass`, Sumedh, 2026-11-08)

A look-only pass over the landing page, claim screen and war map, done by Sumedh while Nithya is out. **No behaviour, API calls, gating, test meanings, button labels or test selectors changed.** The code editor canvases (Monaco, Blockly) are untouched. Checked with `npm run build`, `npx vitest run` (167/167) and the full Playwright suite (87/87). Screenshots: `design-refs/before/` and `design-refs/after/` (1440×900 and 390×844, deviceScaleFactor 1, against `npm run dev:mock` with published demo data; the `warmap-statuses-*` set adds one eliminated and one disqualified team).

**Direction.** WWI trench warfare, like a dark war film: desaturated, cold slate sky, mud, olive, khaki, faded paper, film grain. One warm accent (`fire`, orange) for actions and highlights; faded red (`alert`) only for danger and eliminations. Stencil (Stardos Stencil) for big headings, typewriter (Special Elite) for documents, JetBrains Mono for data. No neon glows.

**Who to tell.** Nithya: everything under `src/warmap/` below. Siddharth: `Login.tsx`, `ClaimCountry.tsx`, and the two glow removals in `SidePanels.tsx`. Both: the shared files `index.css`, `ui.tsx` and `App.tsx`.

### Theme and shared (`src/index.css`, `src/components/ui.tsx`, `src/app/App.tsx`)
- **Tokens retuned** (all text colours pass WCAG AA on `ink` and `panel`): `ink #0e1011`, `panel #191c1b`, `steel #2b302d`, `steel-light #4a514b` (borders only), `muted #999b8e`, `paper #d9d3c3`, `alert #cf6858` (faded red), `alert-dim #4e2620`, `amber #b99a5e` (dull brass, pending/warnings), `coop #8f9e62` (olive), `peace #8299ad` (slate blue).
- **New tokens:** `fire #d97a35` and `fire-light`, `khaki`, `mud`, and the paper inks `type-ink`, `type-muted`, `type-red`, `type-brass`, `type-rust`, `type-olive` (AA on the darkest 1% of `paper.jpg` under the `.paper` wash). `--font-stencil` (new dependency `@fontsource/stardos-stencil`). `@theme` is now `@theme static` so every token is on `:root` for plain CSS such as `WarMap.css`.
- **New shared classes:** `.film-grain` (replaces `.scanlines`), `.stencil`, `.weathered` (noise-masked worn paint, big headings only), `.paper` (paper.jpg, cover, never tiled, light wash, ink text), `.paper-input` (a typed form line on paper), `.snow` (CSS-only drifting snow; still under reduced motion).
- **Glows removed, class names kept** so existing markup still works: `.glow` is now a dark pressed-ink shadow, `.defcon-glow-*` are flat tinted fields, `.logo-flicker` does nothing, `.panel-3d` is a softer drop shadow. `zone-closing`/`zone-critical` (5 and 1 minute) are a slow brass / faded-red edge instead of a neon pulse, and still under reduced motion; timing unchanged. `.text-orange` and `.transmit-bar` use `fire`. The boot lines are khaki typewriter, with the cursor at the end of the text, still under reduced motion.
- **`ui.tsx`:** `active` badge tone added (khaki). Primary button is `fire` with ink text (was red with a glow); ghost hovers to `fire`; danger stays faded red without the glow. `inputClass` focus is a thin `fire` outline. Glow drop-shadows removed from `WindowTimer`, `Countdown`, `ConnectionStatus`, toasts. DEFCON ZERO badge border uses `paper`.
- **`App.tsx` header:** brand in stencil with a small `fire` bar (was a blinking red square); active tab and numbers in `fire`. **Fix:** the header wraps instead of overflowing at phone width (`min-h-14 flex-wrap`, nav scrolls sideways); at 1024px everything still fits on one line (e2e "the header fits a small laptop screen"). The war map's `<main>` scrolls below 900px (see war map fix). Organisers won't use phones, so the cut-off second tab at 390px is left as a swipe.

### Landing page (`src/workspace/auth/Login.tsx`)
- Full-screen `hero.jpg` (soldier on the right) under a left-to-right dark gradient, a top/bottom band and a vignette; on phones the gradient runs top to bottom. Drifting snow and film grain over it.
- Left column: field-telegraph boot lines (text only: "LINE TO HQ… ESTABLISHED", "CIPHER KEY… VERIFIED", then as before), eyebrow, "DEFCON ZERO" in weathered stencil, tagline in typewriter.
- The login card is a paper clearance form ("Form DZ-1 · Request for clearance") with typed underlined fields, a faded red "Top secret" stamp, the `fire` "Request Clearance" button and an ink-outlined "View Big Board · War Map" (the 👁️ emoji is gone; the test matches `/View Big Board/`). "> CLEARANCE DENIED", the error alert and the expired-session note are in paper inks. Fields, aria-labels and submit logic unchanged.
- Measured: every text line over the photo is ≥ 4.59:1 at 1440, 390, 1920 and 1024px.

### Claim screen (`src/workspace/auth/ClaimCountry.tsx`)
- `claim.jpg` behind, with the same gradient (dark under the list, open on the right).
- Territory list: a translucent dark field-kit `Panel`; the selected territory is `fire` (was amber with a glow), hover is khaki.
- The claim panel is a paper sheet ("Form DZ-2 · Registration of nation") in place of the dark `Panel`: same title, text, label, input, hint, emblem preview, selected territory (now in stencil), error and Lock in button. Emblem colours are printing inks that read on paper (visual only). "Nation Established" is an olive-ink stamp on paper, no glow.

### War map (`src/warmap/`, Nithya)
- **`WarMap.css` rewritten (look only, every selector kept):** the table is `warmap-table.jpg`, blurred and dimmed behind everything. The map frame shows that photo's own blank sheet (the torn top-left part, x 180–1500 / y 58–780 of the photo, exactly the map's 1.83 ratio), under a light wash that fades the photo's printed grid. Land is paper with ink borders, the sea a faint slate wash, the graticule sepia. Ranked nations are their ink, multiplied into the paper. **Eliminated:** faded and hatched in charcoal. **Disqualified:** hatched in faded red with a "Disqualified" stamp across the country. The header is a typed round banner on `paper.jpg` (DEFCON as a rubber stamp, game in stencil). The leaderboard is a typed field dispatch on `paper.jpg`; fallen rows use muted ink (never faded below AA), disqualified is struck through in faded red. Event ticker, status notice and the signal-lost screen are typed paper slips. All glows (country halo, swatches, notices, live dot) and the white flash and sparks on a fall are replaced by ink effects. Fonts follow the theme (`--font-mono`/`--font-type`/`--font-stencil`).
- **Bug fix (map hidden at 900px and below):** the body's single `minmax(0, 1fr)` row gave the map whatever was left under a tall leaderboard, which was nothing, and the app's `<main>` didn't scroll. Below 900px the war map now grows to its content (`grid-template-rows: auto auto`, frame `max-height: none`), `WarMapPreview`'s root becomes `h-auto min-h-full`, and `App.tsx`'s war map `<main>` gets `max-[900px]:overflow-y-auto`.
- **`WarMap.tsx` (visual only):** `AmbientBackground` (radar + starfield) is no longer rendered (the file is kept, unused); the `#warmap-glow` filter and the ocean gradient are gone; new SVG hatch patterns `#warmap-elim` / `#warmap-dq` (colours in CSS); a stamp layer draws "Disqualified" at each disqualified country's anchor.
- **`palette.ts`:** only the 10 hex values changed, to muted printing inks: slate blue / prussian, olive / moss, ochre / raw umber, rust / dull red, plum / dusty mauve. Families, `NEIGHBOURS`, the colouring algorithm and `palette.test.ts` are unchanged and pass.
- **`WarMapPreview.tsx`:** only the root's phone sizing above.

### Images (`public/`)
`hero.jpg`, `claim.jpg` and `paper.jpg` were cropped from the right and bottom, and `warmap-table.jpg` from the right only, to remove a generator watermark (sparkle) in the bottom-right corner (hero/claim 1700×956, paper 860×860, warmap-table 1712×1071). The uncropped originals are in git (commit 38ba5d4).

### Left as is
- Some non-neighbour nations share a colour on the leaderboard (e.g. Canada and Japan, both moss): by design, only neighbours must differ.
- "DEFCON STATUS: 3" in the boot lines is hard-coded, as before (decoration only).
- The landing page scrolls on short screens (e.g. 1024×700); it fits at 1440×900 and above.
- Not in this pass: the round 2 troop-placement map (`workspace/editor/TroopPlacement.tsx`) and the Blockly grid still use hard-coded dark hex colours; the editor canvases were out of scope.


### Follow-up after testing on the real backend in Safari (2026-11-08)
- **Countdown looked empty (header "Window closes", workspace "Window closing").** Not a colour or rendering bug, and not Safari's date parsing (JavaScriptCore parses the backend's microsecond timestamps fine). The real backend's Round 1 is `open` but its `closes_at` passed hours ago (no one pressed Start), so the time left is 00:00, and under a minute the digits had the `blink` class: invisible half of every second. `main` had the same `blink` (ui.tsx `WindowTimer` and `Countdown`). Fix: the digits never blink in `WindowTimer`, `Countdown` and the organiser console timer (`OrganiserConsole.tsx`); under a minute they are steady faded red, and the header label reads "Window closed" at 00:00. The red window edge still signals urgency.
- **Slow clicks in Safari.** Measured with `vite preview` of a production build, headed Chrome and Playwright WebKit (Safari's engine; real Safari needs `safaridriver --enable`), with the window under a minute. Cause 1: the login snow animated `background-position` on two full-screen layers (one with a blur filter), so WebKit repainted the whole screen every frame: 80–130 ms frames, 156–270 ms from click to paint. Cause 2: the war map's CSS `filter: blur() brightness() saturate()` on the full-screen table backdrop, re-run on every map update. Fixes: snow animates `transform` only on two pseudo-element layers (no blur); the table backdrop is a baked image (`public/warmap-table-dim.jpg`: dimmed, desaturated, blurred, 1024×640); `hero.jpg` and `claim.jpg` have their desaturation baked in (the `saturate-[0.8]` classes are gone); film grain is a static baked tile (`public/grain.png`) with no blend mode or SVG filter; nation fills no longer use `mix-blend-mode: multiply`; the fallen-row swatch uses a colour mix instead of `filter: grayscale`. No CSS `filter`, `mix-blend-mode` or `backdrop-filter` is left in the app. Same-session A/B in WebKit: login 80–95 ms → 16.6 ms frames and 156–161 → 28–29 ms click to paint; war map toggle 65–68 → 56–59 ms. Chrome unchanged (16.6 ms frames, ~30 ms).
- **War map:** claimed, unranked nations are a 62% wash of their ink with a darker outline of it (was 32%), still lighter than ranked nations. The status note ("Round in progress" etc.) is a small slip in the top-left corner of the map over the open Pacific (was a wide plate across the top centre); below 900px it sits just above the map.
- **Login:** `paperPrimaryClass` in `ui.tsx` (used by "Request Clearance" and the claim screen's "Lock in"): enabled is solid fire with ink text, an ink border and an ink drop shadow; disabled is unfilled with a dashed muted-ink outline (was faded fire, which read as broken). Vertical spacing tightened (telegraph lines, gaps, form padding; smaller title and gaps on short screens) so the whole form fits without scrolling at 1440×900, 1280×800 and Safari's inner heights on those screens (1440×790, 1280×690).
- **Workspace at ~1000 px:** both grid columns get `min-w-0`, so a wide editor or long content can never push the right column (or the page) past the right edge. The Command panel (timer, Submit) is no longer `sticky`; on wide screens the panels below it scroll in their own area under it, so the rules no longer slide beneath it and Submit stays on screen (e2e "Submit stays on screen…" still passes). The horizontal overflow itself did not reproduce in WebKit or Chrome at 1000–1180 px, on load or after resizing from 1440/1600; if it still shows in Safari, a screenshot with the window width and zoom level would help.
