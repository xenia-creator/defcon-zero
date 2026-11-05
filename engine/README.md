# Engine

The game engine for DEFCON ZERO. It runs Prisoner's Dilemma, Theatre of War and Foreign Aid, including the built-in bots.

Rounds 2 and 3 follow the proposed numbers in `docs/rules.md`. Those numbers are implemented here and still need team approval. The sandbox in `engine/sandbox.py` is unchanged: it still checks only `C` and `D`.

## What is implemented

- All three games, their action sets, payoff tables and forfeit credits.
- Foreign Aid resources: both players start at 10, aid costs 1, the receiver gains 3, and resources stay at 0 or above.
- Noise: Round 1 flips, Round 2 picks one of the other two actions, Round 3 swaps aid and withhold. The default noise is `0`.
- Every documented built-in bot, behind one registry.
- A match runner. Histories are copies of the moves actually scored, oldest first.
- Direct-play forfeits for an invalid action, a crash, or a timeout (`play_match(..., guard=True)` or `timeout=`).

## Still waiting on the team

`docs/rules.md` section 11 is still open. In particular:

- Round 1 turns, repetitions and noise are not chosen. Callers pass them in.
- The Round 2 table, the Round 3 resource numbers, turns (200), noise (`0`) and forfeit credits are the proposed defaults, not an approved rules lock.
- `adaptive_aid` treats "at least half of the last five moves" as the decision. That reading is still marked TBD.
- How many bots advance, whether bots face copies of themselves, and whether the turn count is hidden are not wired into a new event. `DEFAULT_EVENT` is still the existing four-round sample.
- Submitted bots are still checked by the sandbox, which only allows `C` and `D`. Updating that checker belongs to the sandbox owner.
- Both bots in a match still share the global `random` stream. A bot can reseed it. That is also left to the sandbox owner.

Chicken and Stag Hunt are still in the engine for the existing sample event. They are not DEFCON ZERO rounds.

## Strategy signature

Every bot uses the same function. There is no state argument.

```python
def strategy(my_history, opp_history):
    return action
```

`my_history` is this bot's previous scored moves. `opp_history` is the opponent's. Both are oldest first, the same length, and already include noise. In Foreign Aid they also include the rule that an unaffordable `AID` is played as `WITHHOLD`. The current turn is not in the lists. The engine passes copies.

The turn number is `len(my_history)`. The bot is not told the scores, the resources, the noise level, the opponent's name, or how many turns are left.

Valid actions:

| Game | Actions |
| --- | --- |
| Prisoner's Dilemma | `"C"`, `"D"` |
| Theatre of War | `"ATTACK"`, `"DEFEND"`, `"EXPAND"` |
| Foreign Aid | `"AID"`, `"WITHHOLD"` |

An action from another game is invalid.

```python
def my_custom_bot(my_history, opp_history):
    if not opp_history:
        return "C"
    return opp_history[-1]
```

A Theatre of War bot uses that game's actions:

```python
def my_war_bot(my_history, opp_history):
    if not opp_history:
        return "EXPAND"
    if opp_history[-1] == "EXPAND":
        return "ATTACK"
    return "DEFEND"
```

## Register a bot

```python
from engine.games import PRISONERS_DILEMMA
from engine.registry import get_bot, register_bot

def my_custom_bot(my_history, opp_history):
    if not opp_history:
        return "C"
    return opp_history[-1]

register_bot("my_custom_bot", my_custom_bot, PRISONERS_DILEMMA)
get_bot("my_custom_bot")
```

`register_bot` rejects a second bot with the same id. Register a bot on the game whose actions it returns. Built-in ids are already taken (`tit_for_tat`, `aggressive`, `always_aid`, and the rest listed below).

`bots_for(game)` returns the bots for one game. `play_registered("aggressive", "defensive", turns=5)` plays two bots that share a game.

## Run a game

From the `defcon-zero` directory:

```python
from engine.games import FOREIGN_AID, PRISONERS_DILEMMA, THEATRE_OF_WAR
from engine.match import play_match
from engine.registry import get_bot

play_match(get_bot("tit_for_tat"), get_bot("always_defect"), PRISONERS_DILEMMA, turns=5)
play_match(get_bot("aggressive"), get_bot("defensive"), THEATRE_OF_WAR, turns=5)
play_match(get_bot("always_aid"), get_bot("never_aid"), FOREIGN_AID, turns=14)
```

`turns` is required. The proposed length for Rounds 2 and 3 is 200 (`THEATRE_OF_WAR.turns` and `FOREIGN_AID.turns`). Pass `noise=` and `seed=` when you need them.

The result has `history1`, `history2`, `score1`, `score2` and `forfeit`. Round 1 and Round 2 scores are the sum of the turn payoffs. The Round 3 score is each player's final resources, starting from 10.

To catch a bad bot yourself:

```python
play_match(bot1, bot2, PRISONERS_DILEMMA, turns=50, guard=True, timeout=2)
```

A forfeit scores 0 for that bot. The opponent scores `3 * turns` in Rounds 1 and 2, and `10 + 2 * turns` in Round 3. Completed turns stay in the history. The match score is the forfeit score.

`guard` stays off by default. The sandbox calls `play_match` that way and applies its own forfeit and disqualification. Turning the guard on inside every match would hide those failures from the sandbox.

A round robin of one game's bots:

```python
from engine.registry import bots_for
from engine.tournament import run_round_robin

run_round_robin(bots_for(THEATRE_OF_WAR), THEATRE_OF_WAR, turns=200, repetitions=1, seed=1)
```

## Built-in bots

Prisoner's Dilemma: `always_cooperate`, `always_defect`, `random_bot`, `tit_for_tat`, `grudger`, `tit_for_two_tats`, `alternator`, `suspicious_tit_for_tat`, `win_stay_lose_shift`.

Theatre of War: `aggressive`, `defensive`, `random_war`, `expansionist`, `fortress`, `balanced`, `opportunistic`.

Foreign Aid: `always_aid`, `never_aid`, `random_aid`, `tit_for_tat_aid`, `reciprocity`, `grudger_aid`, `majority_aid`, `adaptive_aid`.

## Layout

| Module | Role |
| --- | --- |
| `games.py` | Actions, payoffs, resources, forfeit credit |
| `noise.py` | Per-round noise |
| `strategies.py` | Round 1 bots (`BUILT_IN_BOTS`, used by the sandbox) |
| `war_strategies.py` | Round 2 bots |
| `aid_strategies.py` | Round 3 bots |
| `registry.py` | Id → bot and game |
| `match.py` | One match |
| `timeout.py` | Time limit used when `play_match` is given `timeout` |
| `tournament.py` | Round robin and leaderboard |
| `event.py` | Sample elimination event |
| `sandbox.py` | Submitted-code checks. Not part of this change |

## Tests

From the `defcon-zero` directory:

```bash
python -m pytest tests/test_engine.py tests/test_defcon_games.py
```

`tests/test_engine.py` is the existing Round 1 suite. `tests/test_defcon_games.py` covers the three games, every bot, noise, resources and forfeits. The timeout test starts a short-lived process and takes about two seconds.
