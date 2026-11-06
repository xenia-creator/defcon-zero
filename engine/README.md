# DEFCON ZERO Engine

The engine provides reusable game, match, bot registry, tournament, and
submission-sandbox components. The current implemented behavior and unresolved
game-rule changes are recorded in [rules.md](./rules.md).

## Architecture

- `games.py` defines game actions, validation, scoring, and forfeit scores.
- `match.py` runs two strategies for a fixed number of turns and returns the
  scored histories, scores, and any forfeit.
- `strategies.py` and `blotto_strategies.py` hold built-in strategies.
- `registry.py` associates built-in IDs with their game and strategy.
- `tournament.py` schedules and summarizes in-process round robins.
- `sandbox.py` validates submitted source and runs safe matches, round robins,
  and submission checks in worker processes.

## Supported rounds and bot interface

Every configured strategy uses the same interface:

```python
def strategy(my_history, opp_history):
    return move
```

Histories contain previous scored moves, oldest first. The match runner passes
copies. Bots do not receive score, opponent identity, noise setting, or
turn-count information.

### Round 1 — Prisoner's Dilemma

Actions are `"C"` and `"D"`. The existing payoff matrix and ten built-in
strategies are preserved. See [rules.md](./rules.md).

### Round 2 — Theatre of War

Bots return five non-negative whole-number allocations totaling 100. Regions
are resolved first, then the turn winner scores one point (or both score half
on a tie). Built-ins are `even_split`, `all_in`, `random`,
`copy_opponent_last`, and `counter_opponent_last`.

### Round 3 — Foreign Aid

The sender/receiver roles alternate. Send and return ranges, tripling, exact
payoffs, and role detection through the existing two-history bot interface are
specified in [rules.md](./rules.md). Built-ins are
`always_send_10_return_half`, `always_send_0_return_0`, `tit_for_tat`, and
`random`.

## Registering and running bots

To add a built-in for a configured game, implement the common strategy
signature in the relevant strategy module, then register it with
`register_bot(bot_id, strategy, game)` from `registry.py`. An ID is unique
within a game; the same ID may be used for different games. Keep game-specific
strategy logic in its strategy module and register it for the matching game.
Use `play_registered(..., game=...)` when an ID such as `random` is ambiguous
across games.

An in-process match can be run with `play_match(bot1, bot2, game, turns, ...)`
from `match.py`. For submitted source, use
`sandbox.play_safe_match(...)`, `sandbox.run_safe_round_robin(...)`, or
`sandbox.test_submission(...)`. The sandbox checks returned actions and treats
bot failures, timeouts, and malformed actions as forfeits. Seeded bot random
streams are independent and reproducible.

`run_safe_round_robin` uses only the explicitly supplied participants; built-in
bots are not inserted into participant tournaments. `test_submission` runs a
submission against the built-ins for its configured game.

`tournament.break_tie(tied_teams, head_to_head, seed=...)` separately returns
the advancement order for tied teams. It uses head-to-head wins first and a
local seeded shuffle for unresolved groups. It does not alter summary ranks;
advancement logic must consume its returned order.

## Sandbox limits

The sandbox validates the strategy signature, restricts imports and selected
language constructs, runs matches in worker processes, enforces a match
timeout, and caps each worker at 512 MiB where the host OS supports the
configured limit. Unix workers use
`resource.setrlimit(RLIMIT_AS)`; Windows workers use a Windows Job Object.
Failure to apply the memory limit is reported rather than silently ignored.
These are resource controls, not strong security isolation: bot code still
runs as the service account.

## Application integration

The engine does not own event sequencing or application state. The calling
application supplies participants and game/turn parameters, decides whether
self-play is enabled, and applies event-specific hidden-turn policy. The
engine has no event runner or backend/database integration.

## Tests

From the repository root, run the engine tests with:

```powershell
python -m pytest engine
```

Add tests for new game behavior under `engine/` when implementing it.
