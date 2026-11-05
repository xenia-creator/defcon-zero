# Frontend

The React app for DEFCON Zero. Shared setup and code live here; each person's screens have their own folder.

| Folder | Owner | What |
| --- | --- | --- |
| `src/workspace/` | Siddharth | Login, country picker, code editor, Blockly, submit, test results |
| `src/warmap/` | Nithya | World map, leaderboard, organiser dashboard, projector view |
| `src/app/`, `src/components/`, `src/lib/` | Shared | App shell, common UI, API client, session, server clock |

## What is where

```
frontend/
  package.json, vite.config.ts   app setup, shared
  index.html                     the page the app starts from
  mock/server.mjs                a pretend backend for testing, not used at the event
  e2e/                           browser tests
  src/
    main.tsx                     where the app starts
    app/App.tsx                  header, and which screen to show
    components/ui.tsx            shared buttons, panels, timer, dialogs
    lib/                         talking to the server, login session, clock
    warmap/                      Nithya's screens
    workspace/                   Siddharth's screens
      auth/                      Login.tsx, ClaimCountry.tsx
      editor/                    Workspace.tsx (main screen), SidePanels.tsx (results, practice, history),
                                 games.ts (the 3 rounds), drafts.ts (autosave), monaco.ts (code editor)
      blocks/                    BlockEditor.tsx (canvas), blocks.ts (block shapes), categories.ts (the six blocks),
                                 generate.ts (blocks to Python), examples.ts (ready-made strategies)
```

## Run it

You need Node 20 or later, and Google Chrome for the browser tests.

```bash
cd frontend
npm install
npm run mock    # a stand-in for the backend, on port 8001
npm run dev     # in a second terminal, then open http://localhost:5173
```

Log in as `team1` or `team2` with the password `demo`, or `admin` for an organiser. These work on the mock only.

To change round on the mock: `curl -X POST localhost:8000/__mock/goto -d '{"index":2}'`

## Tests

```bash
npm test            # logic: clock, saved data, Python from blocks
npm run test:e2e    # real browser: tries to break the screens
```

## Following the API

The screens follow `docs/api.md` v2, and `src/lib/contract.ts` checks every server answer against it. If the contract changes, change that file and `mock/server.mjs`.

The backend is expected on port 8001. To point the dev server somewhere else: `API_TARGET=http://192.168.1.10:8001 npm run dev`.

## How blocks work

Every round uses the same six blocks (`src/workspace/blocks/categories.ts`), and the moves in their dropdowns come from the round's `config.moves`. They become Python in the browser (`generate.ts`), using only `my_history` and `opp_history`, so they need no helper functions from the engine.

## Not final

- **Rounds 2 and 3:** the text, starter code and examples (`src/workspace/editor/games.ts`, `src/workspace/blocks/examples.ts`) follow the proposed moves in `docs/api.md` v2 and `docs/rules.md`, which the team has yet to approve.
- **Country names:** `GET /territories` only sends codes in v2, so the browser turns codes into names.
- **Nation name rules:** 3 to 24 letters, numbers or spaces, as in contract v1. v2 doesn't state them.
