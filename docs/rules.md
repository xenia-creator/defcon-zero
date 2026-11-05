# DEFCON ZERO – Game Rules

**Status: draft v0.3 – not approved.** The engine implements this draft, including the proposed Round 2 and Round 3 numbers. Section 11 is still open.

Tags used in this document:

- **[IMPLEMENTED]** – already works in the engine code (Round 1 only, unless a later section says the engine now follows a proposed rule).
- **[PROPOSED]** – REQUIRES TEAM APPROVAL. A sensible default chosen for the draft.
- **[TBD]** – TEAM DECISION REQUIRED. The team must decide.

Every number in Rounds 2 and 3 is **[PROPOSED]**. The event report that should define these games was not available.

---

## 1. Overview

Teams submit bots. Bots play repeated two-player games over three rounds.

| Round | Game | Actions |
|---|---|---|
| 1 | Prisoner's Dilemma | `C` (cooperate), `D` (defect) |
| 2 | Theatre of War | `ATTACK`, `DEFEND`, `EXPAND` |
| 3 | Foreign Aid | `AID`, `WITHHOLD` |

Each round uses only its own actions. Returning an action from another round is invalid.

---

## 2. How a match works (all rounds)

1. Two bots play a fixed number of turns, `T`. There is no early ending.
2. Both bots choose **at the same time**. Neither sees the other's current move.
3. Each turn: both bots choose → noise may change a move → the result is scored → both moves are added to the history.
4. The history records what was **actually played** (after noise), so both bots see the same record.
5. A bot **forfeits** if it crashes, times out, or returns an invalid action. It is never given a default move.
   - The forfeiting bot scores 0 and its opponent gets the *forfeit credit* (section 7).
   - In a round, a forfeiting bot is **disqualified** and all its matches are removed, so everyone else is still compared on the same opponents.

### Noise [IMPLEMENTED for Round 1, PROPOSED for Rounds 2–3]

Noise is a chance `noise` (0 to 1) that a bot's move is replaced. Default `0.0` [PROPOSED].

- Round 1: the move flips to the other action.
- Round 2: the move becomes one of the *other two* actions, picked at random.
- Round 3: `AID` and `WITHHOLD` swap.

### Seeds and repeatability [IMPLEMENTED]

- One seed per tournament produces one seed per match, so the same code, same seed and same settings always give the same result.
- No seed means results are random.
- **Bot order matters.** The same bots listed in a different order get different match seeds. [PROPOSED] The backend should always pass bots in the same fixed order (for example sorted by team id).
- **Known issue:** both bots in a match draw from one shared random stream, and a bot can reseed it. This is for the sandbox owner to fix; it is not specified here.

---

## 3. Round 1 – Prisoner's Dilemma [IMPLEMENTED]

Preserved from the existing engine.

| Row \ Column | `C` | `D` |
|---|---|---|
| **`C`** | 3, 3 | 0, 5 |
| **`D`** | 5, 0 | 1, 1 |

- A match score is the sum of a bot's payoffs over all turns.
- Turn 1: both histories are empty.
- Number of turns, repetitions and noise for DEFCON ZERO: **[TBD]**.

---

## 4. Round 2 – Theatre of War

**Confirmed:** three actions (Attack, Defend, Expand) and the seven bots below.
**Everything else is [PROPOSED].** The brief does not say whether there is a map or troops, so I proposed the smallest game that fits the seven bots: no map, just a payoff table.

### Setup [PROPOSED]

| Question | Rule |
|---|---|
| Players | 2 |
| Map, regions, troops | None. Points scored stand in for territory. |
| Starting state | Both scores are 0 |
| Turns | `T = 200` |
| Order | Simultaneous |
| Early victory | None. The winner is decided after `T` turns. |

### Scoring each turn [PROPOSED]

Each cell shows (row player's points, column player's points).

| Row \ Column | `ATTACK` | `DEFEND` | `EXPAND` |
|---|---|---|---|
| **`ATTACK`** | 1, 1 | 0, 2 | 5, 0 |
| **`DEFEND`** | 2, 0 | 2, 2 | 1, 4 |
| **`EXPAND`** | 0, 5 | 4, 1 | 3, 3 |

In plain words (every effect lasts one turn only):

- **Attack** only works against Expand: the attacker gets 5, the expander 0. Against Defend it fails (0 for the attacker, 2 for the defender). Two attackers fight a costly war (1 each).
- **Defend** only protects against an attack in the same turn. Against Expand the defender gets only 1.
- **Expand** costs nothing. Two expanders get 3 each. If the opponent defends, the expander gets 4.
- Nothing is random. Each cell is one fixed result.

Why this table: attack beats expand, defend beats attack, expand beats defend. No single action always wins, and two expanders together score the most (6) while each is tempted to attack (5 instead of 3).

### The seven bots

`opp_last` is the opponent's most recent move. `t` is the turn number starting at 0.

| Bot | What it does | First move |
|---|---|---|
| `aggressive` | Always `ATTACK` | `ATTACK` |
| `defensive` | Always `DEFEND` | `DEFEND` |
| `random_war` | Random pick of `ATTACK`, `DEFEND`, `EXPAND` | random |
| `expansionist` | `ATTACK` if `opp_last` was `ATTACK`, otherwise `EXPAND` | `EXPAND` |
| `fortress` | `DEFEND`, but `ATTACK` while the opponent's last 3 moves were all `ATTACK` | `DEFEND` |
| `balanced` | Repeats `ATTACK`, `DEFEND`, `EXPAND` in order (move number `t mod 3`) | `ATTACK` |
| `opportunistic` | Against `EXPAND` → `ATTACK`; against `DEFEND` → `EXPAND`; against `ATTACK` → `DEFEND` | `EXPAND` |

---

## 5. Round 3 – Foreign Aid

**Confirmed:** two actions (Aid, Withhold) and the eight bots below.
**Everything else is [PROPOSED].**

### Setup [PROPOSED]

| Question | Rule |
|---|---|
| Players | 2 |
| Starting resources | 10 each |
| Aid | Fixed amount of 1. No partial aid. |
| Cost to the giver | 1 |
| Benefit to the receiver | 3 (multiplier of 3) |
| Both aid in the same turn | Yes |
| Can aid fail | No (only noise can change a move) |
| Limits | Resources never go below 0. No upper limit. |
| Turns | `T = 200` |
| Randomness | Only noise, controlled by the seed |

### Each turn [PROPOSED]

1. Apply noise to each bot's choice.
2. If a bot chose `AID` but has less than 1 resource at the start of the turn, its action becomes `WITHHOLD` (not an error, not a forfeit).
3. Update resources. With `g = 1` if a player aided, otherwise `0`:

```
my resources = my resources − 1·g_me + 3·g_opponent
```

Net change per turn:

| Row \ Column | `AID` | `WITHHOLD` |
|---|---|---|
| **`AID`** | +2, +2 | −1, +3 |
| **`WITHHOLD`** | +3, −1 | 0, 0 |

A player who is exploited every turn can pay only 10 times, then holds 0 and can no longer aid.

**Match score = final resources.**

### The eight bots

`opp_aids` = how many times the opponent has chosen `AID`; `n` = number of turns played so far.

| Bot | What it does | First move |
|---|---|---|
| `always_aid` | Always `AID` | `AID` |
| `never_aid` | Always `WITHHOLD` | `WITHHOLD` |
| `random_aid` | `AID` or `WITHHOLD`, half each | random |
| `tit_for_tat_aid` | Copies the opponent's last move | `AID` |
| `reciprocity` | `AID` with probability `opp_aids / n` (the opponent's overall aid rate) | `AID` |
| `grudger_aid` | `AID` until the opponent withholds once, then `WITHHOLD` forever | `AID` |
| `majority_aid` | Does what the opponent did most often. A tie means `AID`. | `AID` |
| `adaptive_aid` | Looks at the opponent's last 5 moves: `AID` if at least half were `AID`, otherwise `WITHHOLD` | `AID` |

Every bot that depends on history opens with `AID`, because there is no history to react to. `adaptive_aid` is read as "majority of the last 5 moves", which is **[TBD]** because the brief does not say how 5 moves become one decision.

---

## 6. Scoring examples

| Example | Result |
|---|---|
| Round 1: `tit_for_tat` vs `always_defect`, 5 turns | 4 vs 9 |
| Round 2: `aggressive` vs `defensive`, 5 turns | 0 vs 10 (`ATTACK` against `DEFEND` gives 0 and 2 each turn) |
| Round 2: `fortress` vs `aggressive`, 6 turns | 9 vs 3 (3 turns of 2 and 0, then 3 turns of 1 and 1) |
| Round 2: `expansionist` vs `opportunistic`, 6 turns | 8 vs 17 |
| Round 3: `tit_for_tat_aid` vs `never_aid`, 6 turns | 9 vs 13 (aids once, then withholds) |
| Round 3: `always_aid` vs `never_aid`, 14 turns | 0 vs 40 (aids 10 times, then cannot afford more) |
| Round 3: `always_aid` vs `always_aid`, 200 turns | 410 each (10 + 2 × 200) |

### Forfeit credit

The opponent of a forfeiting bot gets the score of a fully cooperative match.

| Round | Opponent gets | Forfeiter gets |
|---|---|---|
| 1 [IMPLEMENTED] | `3 × T` | 0 |
| 2 [PROPOSED] | `3 × T` (the Expand/Expand payoff) | 0 |
| 3 [PROPOSED] | `10 + 2 × T` (a full mutual-aid match, 410 at 200 turns) | 0 |

In a normal round these scores are discarded, because all matches of a disqualified bot are removed.

---

## 7. Winning and ties

- **Match winner:** higher match score. Equal scores are a draw. [Round 1 IMPLEMENTED, Rounds 2–3 PROPOSED]
- **Round ranking:** by **total** match score. Wins, losses and draws are recorded but do not affect ranking. [IMPLEMENTED]
- **Tie on total at the cut line:** first the average score in head-to-head matches against the other tied bots, then a coin flip controlled by the seed. [IMPLEMENTED]
- **Early victory:** none.

Why the ranking rule matters: in the simulation I ran for checking (not in the repo), `never_aid` won the most Round 3 matches but finished last on total score, and `aggressive` won 9 Round 2 matches but scored lowest. Ranking by total score is what the engine does today. Please confirm it. **[TBD]**

---

## 8. Bot inputs

### Round 1 [IMPLEMENTED]

A Round 1 bot is a function that receives two lists and returns `"C"` or `"D"`:

```python
def strategy(my_history, opp_history):
    return "C"
```

- The lists hold past moves, oldest first, including noise effects.
- They are copies, so a bot cannot change the real history.
- The turn number is `len(my_history)`.
- Total turns, scores, the noise level and the opponent's identity are not shown.
- Invalid return value, crash or timeout means forfeit.

### Rounds 2 and 3 [PROPOSED]

The engine now uses the same two histories as Round 1. A `state` object was not added. Whether bots should also see scores or resources is still **[TBD]**.

- Bots receive the same two histories, now holding that round's actions (`ATTACK`/`DEFEND`/`EXPAND` or `AID`/`WITHHOLD`).
- The histories store the move that was scored: after noise, and after an unaffordable `AID` becomes `WITHHOLD`.
- Total turns are never shown, so a hidden turn count still works.

---

## 9. Tournament rules [IMPLEMENTED unless marked]

**One round:**

1. Each repetition, every bot plays a copy of itself and then every other bot once.
2. A bot's round total is the sum of its match scores (a match against itself adds one side's score).
3. Disqualified bots are removed together with all their matches.

**Across rounds:**

- Only survivors play the next round, and scores start fresh each round.
- The top bots advance (a fixed count or a fraction).
- Optionally the number of turns of a round can be hidden (randomly 25% fewer or more, controlled by the seed).

**Undecided for DEFCON ZERO [TBD]:** how many bots advance from each round, number of repetitions and turns, whether scores carry over between rounds, whether bots play copies of themselves, how the champion is chosen after Round 3.

---

## 10. Engine status

Implemented from this draft, still subject to the decisions in section 11:

- Each round has its own action set, noise rule and forfeit credit.
- Foreign Aid stores both players' resources and scores the match by the final amounts.
- The built-in bots for all three rounds are registered by id.

Still elsewhere:

- `engine/sandbox.py` still accepts only `C` and `D`, and still pays the Round 1 forfeit itself. That file was left for the sandbox owner.
- `DEFAULT_EVENT` is still the older four-round sample. Advancement and the real DEFCON round order are team decisions.
- Both bots in a match still share one random stream. That is for the sandbox owner to fix.

---

## 11. Decisions for the team

| # | Decision | Status |
|---|---|---|
| 1 | Round 1: turns, repetitions, noise | TBD – TEAM DECISION REQUIRED |
| 2 | Round 2: payoff table (section 4) | PROPOSED – REQUIRES TEAM APPROVAL |
| 3 | Round 2: plain table, or a game with a map and troops? | TBD – TEAM DECISION REQUIRED |
| 4 | Round 3: starting resources 10, aid 1, multiplier 3, floor 0 | PROPOSED – REQUIRES TEAM APPROVAL |
| 5 | Round 3 is a Prisoner's-Dilemma-style game: giving costs 1 and helps the opponent by 3, so withholding is always tempting. Is that the intent? | TBD – TEAM DECISION REQUIRED |
| 6 | `adaptive_aid` reading (section 5) | TBD – TEAM DECISION REQUIRED |
| 7 | Turns (200) and noise (0.0) for Rounds 2 and 3 | PROPOSED – REQUIRES TEAM APPROVAL |
| 8 | Forfeit credits for Rounds 2 and 3 | PROPOSED – REQUIRES TEAM APPROVAL |
| 9 | Bot inputs for Rounds 2 and 3 | TBD – TEAM DECISION REQUIRED |
| 10 | Fixed bot order for repeatable results | PROPOSED – REQUIRES TEAM APPROVAL |
| 11 | Round ranking by total score | TBD – TEAM DECISION REQUIRED |
| 12 | Tournament numbers (section 9) | TBD – TEAM DECISION REQUIRED |
| 13 | Hidden turn count in Rounds 2 and 3 | TBD – TEAM DECISION REQUIRED |

---

## 12. Change log

| Version | Date | Change |
|---|---|---|
| 0.3 | 2026-11-05 | Engine implements this draft. Round 2 and 3 bots use the two-history signature. History stores the scored move. |
| 0.2 | 2026-11-05 | Shortened and simplified. DEFCON ZERO only. Rounds 2 and 3 use only their own actions. |
| 0.1 | 2026-11-05 | First draft. |
