# DEFCON Zero — Frontend

Read this first, every session. Context + hard rules for all Claude Code work on the frontend.

## What this is
A strategy-bot tournament for the Gradient AI Club. Teams build bots that compete over three rounds; a live war map + leaderboard track the event.
- Round 1 (DEFCON 3): The Prisoner's Dilemma
- Round 2 (DEFCON 2): Theatre of War (Colonel Blotto)
- Round 3 (DEFCON 1): Foreign Aid (the Trust Game)
Roles: team (plays), organiser/admin (runs the event), spectator (public big board).

## Hard rules — never break these
1. Only edit files under `frontend/`. NEVER edit `backend/`, `engine/`, `infra/`, or `docs/api.md`. If backend or engine behaviour needs to change, STOP and say so — we ask the owner (Sumedh = backend, Shashwat = engine). Do not work around it by editing those files.
2. The API contract is `docs/api.md` (read-only). Read it at the start of every session and build strictly to it. Never invent request/response shapes. If something you need isn't in the contract, flag it — don't guess.
3. Keep the mock in sync with the contract: `frontend/mock/server.mjs` and `frontend/src/lib/contract.ts` must match `docs/api.md`. Change one, align the others.
4. Don't commit. Make changes, run checks, report. The human commits and reviews.

## How we build
- Follow existing patterns — file layout, naming, component style, and the DEFCON Zero look (colours, mono type, `src/lib/rounds.ts`, `src/app/views.ts`, `src/lib/config.ts`). Don't reinvent what exists.
- Everything in its place. Each feature lives in its proper section; nothing scattered. Keep the flow intuitive and consistent: login → claim nation → round-gated workspace → submit; organiser console; public war map.
- Respect role + round gating (`src/app/views.ts`): teams see only their current round, no leaderboard.
- Handle every state cleanly: loading, empty, error, and "no round yet" (GET /standings 404). Never show a raw error screen.
- Verify: typecheck + unit tests, and Playwright where useful, before reporting.

## Ownership (avoid collisions)
- Nithya: war map (`src/warmap/`), spectator/projector, organiser console (`src/workspace/organiser/`).
- Siddharth: auth/login/claim (`src/workspace/auth/`), team workspace/editor (`src/workspace/editor/`).
- Shared (`src/app/App.tsx`, `src/lib/`, `src/components/ui.tsx`): coordinate before changing — tell the other person first.

## Session workflow
- Work one numbered sub-step at a time. After each sub-step, STOP and report before starting the next:
  - What you did in this step.
  - Decisions that need a human call — list the options and your recommendation.
  - Issues you hit, with your proposed resolution(s).
- Then wait for my go-ahead (and my input on any decisions) before the next sub-step. Never run through multiple steps without checking in.