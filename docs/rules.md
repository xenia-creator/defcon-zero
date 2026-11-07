# DEFCON ZERO Engine Rules

This is the engine's source of truth for game actions, validation, and scoring.

## Shared bot interface

All bots use:

```python
def strategy(my_history, opp_history):
    return move
```

Histories contain previous actions, oldest first, and are passed as copies.
No score, opponent identity, noise setting, or turn count is provided.

## Round 1 — Prisoner's Dilemma

The actions are `C` (Cooperate) and `D` (Betray). Turn scores sum to the match
score.

| Player 1 \ Player 2 | C | D |
|---|---:|---:|
| C | 3, 3 | 0, 5 |
| D | 5, 0 | 1, 1 |

The existing ten built-in strategies retain their intent using the `C`/`D`
contract. A forfeiting bot receives zero; its opponent receives 3 points per
configured match turn.

## Round 2 — Theatre of War

Each bot returns a list of exactly five whole-number allocations, each
non-negative and totaling exactly 100. Floats, booleans, malformed lists, and
other totals are invalid and forfeit the match.

Compare allocations simultaneously across the five regions. The higher
allocation wins a region; equal allocations tie and count as half a region for
each player. After all regions are resolved, the player with more region wins
scores 1 for the turn and the other scores 0. If the region-win totals are
equal, both score 0.5. A forfeiting bot receives zero; its opponent receives
3 points per configured match turn. Non-zero noise is not defined and is
rejected.

The five registered built-ins are:

- `even_split`: `[20, 20, 20, 20, 20]`.
- `all_in`: `[100, 0, 0, 0, 0]`.
- `random`: a seeded-random valid composition of 100.
- `copy_opponent_last`: copies the opponent's latest allocation, or returns
  the even split if there is no history.
- `counter_opponent_last`: increments the opponent's three weakest regions
  (lowest allocation, with region index breaking equal-value ties) by one.
  It removes the three added troops from the largest non-target region first,
  with index breaking ties. The two non-target regions always contain enough
  troops: the three weakest of five allocations totaling 100 can sum to at
  most 60, leaving at least 40 outside those regions. With no history it uses
  the even split.

## Round 3 — Foreign Aid

Turn roles alternate. Player 1 is sender on even-numbered turns (turn zero is
the first turn); player 2 sends on odd-numbered turns.

At the start of each turn, the sender receives 10 fresh points and chooses an
integer `sent` from 0 through 10. The receiver receives `3 * sent` and chooses
an integer `returned` from 0 through `3 * sent`.

The sender's turn score is `10 - sent + returned`. The receiver's turn score
is `3 * sent - returned`. Match scores are the sum of each participant's
scores over turns.

The strategy signature remains unchanged. Role is inferred from history
lengths:

- When sending, `len(opp_history) == len(my_history)`.
- When receiving, `opp_history` has one extra final entry; that entry is the
  current amount sent by the opponent.

The registered built-ins are `always_send_10_return_half` (floor division for
the half-return), `always_send_0_return_0`, `tit_for_tat`, and `random`.
Tit-for-tat sends the opponent's last send (or zero if unavailable) and returns
its own previous return (or zero if unavailable), clamping both to valid
ranges. The random strategy uses the bot's seeded private random stream.

Invalid action types, boolean values, and out-of-range actions forfeit using
the engine's existing forfeit mechanism. Other games reject non-zero noise;
Foreign Aid has no noise rule.

## Tournament tie-breaking

`tournament.break_tie` is a separate advancement-order helper; it does not
change aggregate leaderboard ranks. It orders tied teams by head-to-head wins
among those teams, ignores head-to-head draws or unavailable scores, and uses
a local seeded RNG to order any remaining tied groups. Advancement code must
use the returned order rather than relying on equal ranks to choose a team.

## Sandbox and event policy

The sandbox validates submitted code and actions, runs isolated worker
processes with time and memory limits, and turns bot failures into forfeits.
Those are resource controls, not strong OS security isolation: code still runs
as the service account.

The engine does not own event sequencing or application state. The calling
application supplies participants and game/turn parameters, sets self-play
policy, and applies event-specific hidden-turn policy.
