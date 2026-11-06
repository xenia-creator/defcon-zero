# DEFCON ZERO Engine

The engine implements the approved `prisoners_dilemma` and `blotto` games.
`trust` is present in the game catalog but deliberately unconfigured until the
team provides its approved action range, scoring, resources, and forfeit rules.

## Bot interface

Every strategy has the same signature:

```python
def strategy(my_history, opp_history):
    return move
```

Histories contain previous scored moves, oldest first. Bots receive copies and
no score, resource, opponent identity, noise setting, or turn-count information.

### Prisoner's Dilemma

Moves are `"AID"` and `"WITHHOLD"`. The prior payoff matrix is preserved:

| Row / Column | AID | WITHHOLD |
|---|---:|---:|
| AID | 3, 3 | 0, 5 |
| WITHHOLD | 5, 0 | 1, 1 |

### Colonel Blotto

Moves are lists of exactly four non-negative integers summing to 10. On each
front, a larger allocation earns one point; a tie gives each bot 0.5 points.
Scores are summed across the four fronts. Noise is not currently defined for
Blotto and a non-zero noise setting is rejected.

Built-in Blotto submission-test strategies are `even_split`, `all_in`,
`random_allocation`, `copy_opponent_last`, and `counter_opponent_last`. A
history-dependent strategy uses `[3, 3, 2, 2]` as its opening allocation.

### Trust

Trust validation, scoring, and submission tests raise/return a blocked status.
No numeric range or game behavior is inferred from another game.

## Tournament and submission checks

`run_safe_round_robin(participant_code, game, turns, ...)` accepts only
explicit participant code. Built-in bots are never added to participant
tournaments automatically. Participant IDs are sorted before scheduling.
Individual match records include forfeits and disqualified participants;
those matches are marked uncounted and omitted from aggregate totals. Each
scheduled match runs once.

`test_submission(code, game=...)` runs the submission against each built-in for
that game and returns the backend `SubmissionCheck` shape:

```json
{
  "error": null,
  "test_results": [
    {"opponent": "always_cooperate", "my_score": 30, "opp_score": 0}
  ]
}
```

Bot random calls use independent streams. A supplied seed makes them
reproducible, and a bot's `random.seed()` cannot alter another bot's stream.

## Worker isolation limits

Each sandbox pool worker is capped at 512 MiB of process memory. Unix workers
use `resource.setrlimit(RLIMIT_AS)`; Windows workers are assigned to a Windows
Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY`. If the OS cannot apply the
limit, the sandbox reports an error and does not run submissions without it.
Windows Job Object assignment can be restricted when the hosting process is
already in a constrained Job Object; this is reported, not silently bypassed.
These limits and the worker timeout are resource controls, not a complete
security boundary: bot code still runs as the service account.

## Backend-owned event policy

The engine has no `DEFAULT_EVENT` or event runner. The backend supplies
participants, handles event ordering, disables self-play as required, and
applies hidden-turn policy.

## Tests

Run the engine test suite from the repository root:

```powershell
python -m pytest engine tests/test_engine.py tests/test_defcon_games.py
```
