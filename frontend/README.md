# Frontend

The React app for DEFCON Zero. Shared setup and code live here; each person's screens have their own folder.

| Folder | Owner | What |
| --- | --- | --- |
| `src/workspace/` | Siddharth | Login, country picker, code editor, Blockly, submit, test results, fair play tracking |
| `src/warmap/` | Nithya | World map, leaderboard, organiser dashboard, projector view |
| `src/app/`, `src/components/`, `src/lib/` | Shared | App shell, common UI, API client, session, realtime, server clock |

## What is where

```
frontend/
  package.json, vite.config.ts   app setup, shared
  index.html                     the page the app starts from
  openapi.json                   the API the screens expect
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
      blocks/                    BlockEditor.tsx (canvas), blocks.ts (block shapes), categories.ts (blocks per round),
                                 generate.ts (blocks to Python), examples.ts (ready-made strategies)
      fairplay/                  fairplay.tsx (tab switch and full screen tracking)
```

## Run it

You need Node 20 or later, and Google Chrome for the browser tests.

```bash
cd frontend
npm install
npm run mock    # a stand-in for the backend, on port 8000
npm run dev     # in a second terminal, then open http://localhost:5173
```

Log in as `team1` or `team2` with the password `demo`. These work on the mock only.

To change round on the mock: `curl -X POST localhost:8000/__mock/goto -d '{"index":2}'`

## Tests

```bash
npm test            # logic: clock, saved data, Python from blocks
npm run test:e2e    # real browser: tries to break the screens
```

## Still to agree

- **API:** the screens follow `openapi.json`, from the prototype. They must be matched to `docs/api.md` once it is up.
- **Blocks:** Python is generated in the browser (`src/workspace/blocks/generate.ts`), but submit still sends the block layout. To be decided: send Python, or compile on the server.
- **Engine:** Round 1 blocks call `opp_last_move()` and `opp_defection_rate()`. Rounds 2 and 3 use placeholder game keys, `strategy()` shapes and blocks (`src/workspace/editor/games.ts`, `src/workspace/blocks/categories.ts`) until the helper list and rules are final.
