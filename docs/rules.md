# DEFCON ZERO — Approved Engine Rules

## Game keys

The only game keys are `prisoners_dilemma`, `blotto`, and `trust`.

All bots use:

```python
def strategy(my_history, opp_history):
    return move
```

Histories contain previous scored moves, oldest first. Both are copies and are
the only game information supplied to a bot.

## Round 1 — Prisoner's Dilemma

The engine's approved move names are `AID` and `WITHHOLD`. They preserve the
existing two-action payoff matrix (AID maps to the prior cooperative action):

| Row \ Column | AID | WITHHOLD |
|---|---:|---:|
| AID | 3, 3 | 0, 5 |
| WITHHOLD | 5, 0 | 1, 1 |

The match score is the sum of turn scores. The existing forfeit credit remains
3 points per turn to the opponent.

## Round 2 — Colonel Blotto

Each bot returns a list of exactly four non-negative integers totaling exactly
10 troops, for example `[4, 3, 2, 1]`. Allocations are simultaneous. On each
front, the bot with more troops earns 1 point, the other earns 0; a tied front
earns 0.5 points for each bot. The turn score is the sum over all four fronts.
An invalid allocation forfeits the match. The existing engine forfeit credit
remains 3 points per turn to the opponent.

Built-in strategies for submission testing:

- `even_split`: `[3, 3, 2, 2]`.
- `all_in`: `[10, 0, 0, 0]`.
- `random_allocation`: a random valid allocation.
- `copy_opponent_last`: copies the previous allocation, or even-splits first.
- `counter_opponent_last`: chooses a valid allocation maximizing fronts won
  against the opponent's previous allocation, or even-splits first.

## Round 3 — Trust (blocked)

The repository, all branches, commit history, and available specifications
contain no authoritative Trust action range or scoring definition. Therefore
the engine exposes the `trust` key but deliberately has no Trust move validator,
scorer, forfeit credit, or submission-test opponents. These behaviors must not
be used until the team approves them.

## Tournament and isolation behavior

- Participants are ordered by team ID before matches are scheduled.
- The leaderboard ranks by total score. Equal totals receive equal ranks; the
  ID order only determines stable display order.
- Built-in bots are used only by submission checks, never added to participant
  tournaments automatically.
- Every scheduled match executes once. Individual records are retained; matches
  involving a forfeiting/disqualified participant are excluded from aggregates.
- Each bot receives a separate, reproducible random stream when a seed is
  supplied. One bot cannot reseed or consume another bot's stream.
- The backend owns event sequencing, self-play policy, and hidden-turn policy.
  The engine does not define a default event.
