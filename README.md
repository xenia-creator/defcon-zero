# DEFCON Zero

Strategy bot tournament for Gradient AI Club, BMSCE, Winter Arc.
Teams lead a nation and code a bot that cooperates or betrays across three rounds, live on a world map.

Private repo for the core team. Do not share outside the team.

## Team

| Folder | Owner | Builds |
| --- | --- | --- |
| `backend/` | Sumedh | FastAPI server, database, login, submissions, job queue, rounds |
| `engine/` | Shashwat | The 3 games, helper functions, built in bots, rules |
| `frontend/src/workspace/` | Siddharth | Login, country picker, code editor, Blockly, submit, timer |
| `frontend/src/warmap/` | Nithya | World map, eliminations, leaderboard, organiser dashboard |
| `infra/` | Kushal | Server setup, Docker, security, lab setup, load testing |
| `docs/` | Everyone | API contract, rules, decisions |

## Rounds

| Round | Game | Teams |
| --- | --- | --- |
| DEFCON 3 | Prisoner's Dilemma | 30 to 15 |
| DEFCON 2 | Theatre of War | 15 to 8 |
| DEFCON 1 | Foreign Aid | 8 to 2, winner and runner up |

Full rules: `engine/rules.md`

## Rules for working in this repo

1. Never push directly to `main`. Main must always run.
2. Make a branch named after your folder and task, for example `warmap/fade` or `backend/login`.
3. Work only in your own folder. Need a change in someone else's? Ask them.
4. Open a pull request to merge. One teammate reviews it before merging.
5. `docs/api.md` is the contract between backend and frontend. Any change is announced in the group first.
6. Never commit `.env`, passwords or keys.

## Running locally

Each folder's README explains how to run that part.

## Timeline

| Day | Milestone |
| --- | --- |
| 1 | API contract and rules locked |
| 4 | Backend API live, frontend switches from mock data to the real API |
| 6 | API frozen |
| 7 | Mock event with volunteers |
| 8 | Lab rehearsal |
| 9 | Code freeze |

## Daily check in

Every evening at 9 PM, in the group: what you finished, what's next, and whether anything is blocking you.

## Links

- Prototype: github.com/xenia-creator/iron-curtain