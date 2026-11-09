# DEFCON Zero: blocks, guided tutorial and app tour

Design spec. Nothing here is built yet. Read with `docs/api.md` section 8 (the game rules).

**Audience:** first-year students who may not know Python.
**Goal:** someone who has never coded builds a sensible strategy for Round 1 or Round 3 with blocks in 10 minutes, and can never submit a block program that the engine rejects for an invalid move.

**Ownership.** Most of this lands in the team workspace (`src/workspace/editor/`, `src/workspace/blocks/`), owned by **Nithya** (`frontend/CLAUDE.md` still names Siddharth for the workspace and auth, and needs updating; auth is now Sumedh's). Anything in `src/app/App.tsx`, `src/lib/` or `src/components/ui.tsx` is shared: **coordination needed** before changing it. No backend, engine or contract change is needed for parts 1 and 2.

---

## 0. Build first: the fallback fix for invalid moves

This is a bug in today's module flow, separate from the new design. Build it before anything else.

**Bug.** If any path through a block module reaches no `play` block, the generated function falls off the end and returns `None`. The engine rejects that as an invalid move (`engine/games.py`). Today the editor shows only an amber warning ("No errors, but a module has gaps") and still allows submit.

**Fix (no confirm dialog, nothing for the team to do).**
- `generate.ts`, `generateModule`: when `alwaysDecides(body)` is false, end the function with the round's first move:
  ```python
      # No block above decided, so play the safe default
      return "C"
  ```
  `"C"` is `moves[0]` from `config.moves`, so it's always legal. When every path already decides, nothing is added.
- `Generated.warnings` and the "module has gaps" status in `Workspace.tsx` are removed.
- An empty module returns `"C"` instead of `return None`.
- Tests (`logic.test.ts` or a new `generate.test.ts`):
  - every generated module, including an empty one and one with an empty `else`, ends in a legal return;
  - no generated Python contains `return None`.

The new blocks mode (below) builds the same guarantee into the strategy block itself.

---

# Part 1: blocks

## 1.1 How blocks mode works

The editor gets a tab pair above the canvas in Rounds 1 and 3, the same pattern as Round 2's map/code tabs:

`▦ Build with blocks` · `</> Write code` · *Whichever is open is what you submit*

- **Build with blocks** opens by default for a team with no submitted version. The canvas holds **one fixed strategy block** that can't be deleted. Everything goes inside it.
- **No modules, names or wiring.** The generator writes the whole of `strategy.py` from the strategy block. "+ Block module", module names and "Use as my strategy" are not shown in this mode.
- **Generated Python** is always visible in a panel under the canvas. It is read-only and updates on every change.
- **Write code** is today's Monaco editor. It keeps today's "+ Block module" tabs for Round 1, with the section 0 fix.
- **Every path returns a legal move.** The strategy block ends with a built-in fallback ("if nothing above decided, …"). In Round 3, every amount goes through a clamp.
- **Problems** (an empty slot, or a Round 3 action in the wrong section) block submit with a plain message. They never reach the engine.

**Storage, within the contract.** `POST /submissions` sends:

```json
{ "round_id": 1, "code": "<generated strategy.py>", "blocks": { "modules": [ <layout with the strategy block> ] } }
```

- That is one module, within `max_modules`.
- When a version is reopened, a top block of type `ic_strategy` or `fa_strategy` opens it in **Build with blocks**, and anything else opens in **Write code**.
- The local draft (`drafts.ts`) keeps both the blocks layout and the hand code, so switching tabs loses nothing.
- `block_limit` counts every block, including the strategy block and number blocks. This is the same counting as `countBlocks` today.

**Block IDs.** Existing IDs keep their type and field values (`ic_play`, `ic_opp_last`, `ic_opp_rate`, `ic_first_turn`, `ic_chance`, `ic_module`), so saved drafts and versions still open. Only their on-screen text changes. New Round 1 blocks use `ic_` IDs. Round 3 blocks use `fa_` IDs.

**Built-in Blockly blocks used:** `controls_ifelse`, `logic_operation`, `logic_negate`. None of them has a mutator. Their text is set through `Blockly.Msg` overrides:
- `CONTROLS_IF_MSG_THEN` = "then"
- `CONTROLS_IF_MSG_ELSE` = "otherwise"
- `LOGIC_OPERATION_AND` = "and", `LOGIC_OPERATION_OR` = "or"
- `LOGIC_NEGATE_TITLE` = "not %1"

**Categories and colours** (both rounds; block text is white, so check AA contrast when building):

| Category | Colour | Holds |
|---|---|---|
| Actions | red `#c0392b` | what the strategy does: play, send, send back |
| Logic | blue `#3867d6` | if, and, or, not, comparisons |
| Opponent | amber `#d68910` | facts about the opponent |
| Me & match | violet `#8e44ad` | facts about me and the turn |
| Numbers | slate `#5d6d7e` | Round 3 only: numbers and maths |
| Chance | teal `#16a085` | randomness |

Actions are the only statement blocks with a red, notched shape. Everything else is a condition or a value that plugs into a slot. This keeps logic and actions visually apart.

---

## 1.2 Round 1: Prisoner's Dilemma

Moves come from `config.moves` (`["C", "D"]`). On screen, C is "cooperate"/"cooperated" and D is "betray"/"betrayed".

### Block list

| On screen | ID | Category | Tooltip | Generated Python |
|---|---|---|---|---|
| **My strategy, every turn:** `[ … ]` **if nothing above decided, play** `[cooperate ▼]` | `ic_strategy` (new) | (container, red) | Your bot runs these blocks from the top every turn. The first move it reaches is the one it plays. | `def strategy(my_history, opp_history):` … then `return "C"` at the end, left out when every path already plays a move |
| **play** `[cooperate ▼]` | `ic_play` | Actions | Play this move this turn. Blocks under it are skipped. | `return "C"` |
| **if** ◇ **then** `[ … ]` | `ic_if` (new) | Logic | If this is true, do the blocks inside. Otherwise carry on below. | `if …:` |
| **if** ◇ **then** `[ … ]` **otherwise** `[ … ]` | `controls_ifelse` | Logic | If this is true, do the first blocks, otherwise the second. | `if …:` / `else:` (an empty `otherwise` is left out) |
| ◇ `[and ▼ / or]` ◇ | `logic_operation` | Logic | "and": both must be true. "or": at least one must be true. | `(A and B)` / `(A or B)` |
| **not** ◇ | `logic_negate` | Logic | True when the condition inside is false. | `not (A)` |
| **opponent** `[betrayed ▼]` **last turn** | `ic_opp_last` (renamed) | Opponent | What the opponent played last turn. False on the first turn. | `len(opp_history) > 0 and opp_history[-1] == "D"` |
| **opponent has ever** `[betrayed ▼]` | `ic_opp_ever` (new) | Opponent | True once the opponent has played this move even once in this match. | `"D" in opp_history` |
| **opponent has** `[betrayed ▼]` `[more than ▼ / less than]` `[50]` **% of the time** | `ic_opp_rate` (renamed) | Opponent | How often the opponent has played this move so far. False on the first turn. | `opp_history.count("D") > 0.5 * len(opp_history)` |
| **I** `[betrayed ▼]` **last turn** | `ic_my_last` (new) | Me & match | What you played last turn. False on the first turn. | `len(my_history) > 0 and my_history[-1] == "D"` |
| **this is the first turn** | `ic_first_turn` (renamed, moved) | Me & match | True only on the first turn of a match, before anyone has moved. | `len(my_history) == 0` |
| `[10]` **% chance** | `ic_chance` | Chance | True this often, at random. 10 % means about 1 turn in 10. | `random.random() < 0.1` |

`import random` is added at the top only when `ic_chance` is used.

### Changes from today's set
- **Renamed (text only, same ID and fields):**
  - "opponent's last move was betray" → "opponent betrayed last turn"
  - "opponent chose betray more than 50 % of the time" → "opponent has betrayed more than 50 % of the time"
  - "first turn?" → "this is the first turn"
  - `if/do/else` → "if … then … otherwise"
- **Moved:** "this is the first turn" goes from Opponent to Me & match.
- **Added:** `ic_strategy`, `ic_if`, `logic_operation`, `logic_negate`, `ic_opp_ever`, `ic_my_last`.
- **Removed from blocks mode:** `ic_module` (the fixed strategy block replaces it), the module name field, "Use as my strategy", and the "gaps" warning.
- **Example dropdown:** "Start from an example…" becomes a **Start from this** list (section 1.5).

### Starting examples

Each loads into the canvas, replacing it after a confirm if the canvas isn't empty. **Nothing is submitted.**

| Name | Description | Blocks |
|---|---|---|
| **Always Cooperate** | Shares every turn, whatever the opponent does. Easy to exploit. | 2 |
| **Always Betray** | Grabs every turn. Wins against a trusting opponent, loses big against another betrayer. | 2 |
| **Tit for Tat** | Starts friendly, then copies what the opponent did last turn. | 4 |
| **Grudger** | Cooperates until the opponent betrays once, then betrays forever. | 4 |
| **Forgiving Tit for Tat** | Like Tit for Tat, but forgives a betrayal 10 % of the time, so two copies can stop a feud. | 7 |

Blocks and generated Python:

```text
Always Cooperate:  My strategy { play cooperate }                      if nothing above decided, play cooperate
Always Betray:     My strategy { play betray }                         if nothing above decided, play cooperate
Tit for Tat:       My strategy { if opponent betrayed last turn then { play betray } }
                                                                       if nothing above decided, play cooperate
Grudger:           My strategy { if opponent has ever betrayed then { play betray } }
                                                                       if nothing above decided, play cooperate
Forgiving TfT:     My strategy { if opponent betrayed last turn then {
                                    if 10 % chance then { play cooperate } otherwise { play betray } } }
                                                                       if nothing above decided, play cooperate
```

```python
# Always Cooperate
def strategy(my_history, opp_history):
    return "C"

# Always Betray
def strategy(my_history, opp_history):
    return "D"

# Tit for Tat
def strategy(my_history, opp_history):
    if len(opp_history) > 0 and opp_history[-1] == "D":
        return "D"
    # If nothing above decided
    return "C"

# Grudger
def strategy(my_history, opp_history):
    if "D" in opp_history:
        return "D"
    # If nothing above decided
    return "C"

# Forgiving Tit for Tat
import random


def strategy(my_history, opp_history):
    if len(opp_history) > 0 and opp_history[-1] == "D":
        if random.random() < 0.1:
            return "C"
        else:
            return "D"
    # If nothing above decided
    return "C"
```

---

## 1.3 Round 3: Foreign Aid (the Trust Game)

### How the generator keeps every amount legal

The bot receives only the two histories, not `config`. So the generator writes `config.endowment` and `config.multiplier` into the file as constants. It falls back to `UNTIL_ROUND_ARRIVES` (10 and 3) only before the round arrives; the engine uses 10 and 3 too.

Every action goes through a clamp, so **any** number a team builds becomes a legal whole number:
- **send:** 0 to `ENDOWMENT`;
- **send back:** 0 to what was received (`MULTIPLIER * opp_history[-1]`).

`int()` rounds down (7.5 becomes 7), the same as the engine's own sample bots. The result is a plain `int`, which the engine requires.

Every generated Round 3 file starts with this header. The helpers marked *(if used)* are added only when a block needs them. Names avoid a leading `_`, which the sandbox bans on attributes, and only `random` is imported (allowed).

```python
import random                      # only if a Chance block is used

ENDOWMENT = 10                     # the most you can send (config.endowment)
MULTIPLIER = 3                     # what you send arrives multiplied by this (config.multiplier)


def legal_send(amount):
    """Any amount becomes a legal send: a whole number from 0 to ENDOWMENT."""
    return max(0, min(ENDOWMENT, int(amount)))


def legal_return(amount, received):
    """Any amount becomes a legal send-back: a whole number from 0 to what you received."""
    return max(0, min(received, int(amount)))


def split_history(my_history, opp_history):
    """Each turn one side sends and the other sends back, so both histories mix the two.
    This sorts them into what each side sent and sent back, oldest first.
    my_sent[i] goes with opp_returned[i], and opp_sent[i] with my_returned[i]."""
    start = len(opp_history) % 2   # where my sends sit in my history
    my_sent = my_history[start::2]
    my_returned = my_history[1 - start::2]
    opp_sent = opp_history[1 - start::2]
    opp_returned = opp_history[start::2]
    return my_sent, my_returned, opp_sent, opp_returned


def average(values):               # (if used)
    """The average, or 0 when there is nothing yet."""
    return sum(values) / len(values) if values else 0


def return_rate(opp_returned, my_sent):   # (if used)
    """What % of what they received the opponent sent back. 0 until they have had something to send back."""
    received = MULTIPLIER * sum(my_sent[:len(opp_returned)])
    return 100 * sum(opp_returned) / received if received > 0 else 0


def ever_short_changed(my_sent, opp_returned):   # (if used)
    """True if the opponent ever sent back less than I sent them."""
    return any(back < sent for sent, back in zip(my_sent, opp_returned))
```

**Why `split_history` is correct.** The engine checked this: `engine/games.py` `ForeignAidGame.collect_actions` gives each bot one history entry per turn, and the receiver's `opp_history` also has the current send at the end.
- When sending, `len(opp_history) == n`, and my sends sit at indices with the parity of `n`.
- When receiving, `len(opp_history) == n + 1`, and my sends sit at the parity of `n + 1`.

So in both cases `start = len(opp_history) % 2`. **Ask Shashwat to confirm** this with an engine test that plays two block-generated bots, since the layout isn't spelled out in api.md.

The `strategy` function always has this shape:

```python
def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        ...blocks from the sending section...
        # If nothing above decided
        return legal_send(5)
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    ...blocks from the receiving section...
    # If nothing above decided
    return legal_return(received * 50 // 100, received)
```

### Role

The user brief asked for role blocks ("if I'm sending" / "if I'm receiving"). This spec makes the role **two fixed sections of the strategy block** instead. That way each role always has its own legal fallback, and "send" can never land where "send back" is needed. See the decision in the Step 1 report.

| On screen | ID | Tooltip |
|---|---|---|
| **My strategy** / **when I'm sending:** `[ … ]` **if nothing above decided, send** `[5]` / **when I'm receiving:** `[ … ]` **if nothing above decided, send back** `[50]` **% of what I received** | `fa_strategy` | Each turn you are either sending or receiving, and it alternates. Your bot runs the section for its role this turn. |

- The fallback fields are whole numbers: send 0–10 (the max is `ENDOWMENT`), send-back 0–100 %.
- Python: the shape above.

### Values (round slots, plug into actions, maths and comparisons)

| On screen | ID | Category | Tooltip | Generated Python |
|---|---|---|---|---|
| **what the opponent sent last** | `fa_opp_sent_last` | Opponent | When receiving, what they just sent you. When sending, what they sent on their last turn as sender. 0 if they haven't sent yet. | `(opp_sent[-1] if opp_sent else 0)` |
| **what the opponent sent back last** | `fa_opp_returned_last` | Opponent | What they sent back the last time you sent to them. 0 if they haven't had the chance. | `(opp_returned[-1] if opp_returned else 0)` |
| **opponent's average** `[send ▼ / send-back %]` | `fa_opp_avg` | Opponent | "send": the average they send. "send-back %": on average, what % of what they received they sent back. 0 before they've done it. | `average(opp_sent)` / `return_rate(opp_returned, my_sent)` |
| **what I received this turn** | `fa_received` | Me & match | What arrived this turn: the amount sent, times 3. **Only under "when I'm receiving".** | `received` |
| **my last** `[send ▼ / send-back]` | `fa_my_last` | Me & match | The amount you sent, or sent back, last time. 0 if you haven't yet. | `(my_sent[-1] if my_sent else 0)` / `(my_returned[-1] if my_returned else 0)` |
| **turn number** | `fa_turn` | Me & match | Counts every turn in the match, sending and receiving, starting at 1. | `(len(my_history) + 1)` |

`fa_opp_returned_last` is an addition to the brief's list. It's the value a reciprocating sender needs ("did they pay me back?").

### Conditions (hexagon slots, plug into "if")

| On screen | ID | Category | Tooltip | Generated Python |
|---|---|---|---|---|
| ⬭ `[is more than ▼ / is less than / is at least / is at most / equals]` ⬭ | `fa_compare` | Logic | Compares two numbers. | `(A > B)`, `(A < B)`, `(A >= B)`, `(A <= B)`, `(A == B)` |
| **the opponent has ever sent back less than I sent** | `fa_opp_ever_short` | Opponent | True once they have ever left you worse off for trusting them. | `ever_short_changed(my_sent, opp_returned)` |
| **this is my first time** `[sending]` / `[receiving]` | `fa_first_time` | Me & match | True the first time you have this role in a match. The word follows the section the block is in. | `len(my_sent) == 0` under sending, `len(my_returned) == 0` under receiving |
| `ic_if`, `controls_ifelse`, `logic_operation`, `logic_negate`, `ic_chance` | (as Round 1) | | | (as Round 1) |

### Actions (statement blocks, red)

| On screen | ID | Tooltip | Generated Python |
|---|---|---|---|
| **send** ⬭ | `fa_send` | Send this amount and stop. Kept between 0 and 10 and rounded down to a whole number. **Only under "when I'm sending".** | `return legal_send(X)` |
| **send back** ⬭ | `fa_return` | Send back this amount and stop. Kept between 0 and what you received, rounded down. **Only under "when I'm receiving".** | `return legal_return(X, received)` |
| **send back** `[50]` **% of what I received** | `fa_return_pct` | Send back this share of what arrived. 34 % or more means the sender doesn't lose. **Only under "when I'm receiving".** | `return legal_return(received * 50 // 100, received)` |

On screen, "return" becomes **send back**. It means the same in the game, and it avoids clashing with Python's `return`, which beginners will see in the generated code.

### Numbers and chance

| On screen | ID | Category | Tooltip | Generated Python |
|---|---|---|---|---|
| `[5]` | `fa_number` | Numbers | A whole number from 0 to 100. | `5` |
| ⬭ `[+ ▼ / − / × / ÷]` ⬭ | `fa_arith` | Numbers | Adds, takes away, multiplies or divides. Dividing by 0 gives 0. | `(A + B)`, `(A - B)`, `(A * B)`, `(A / B if B != 0 else 0)` |
| `[50]` **% of** ⬭ | `fa_percent_of` | Numbers | This percentage of a number, for example 50 % of 12 is 6. | `(50 / 100 * X)` |
| **random number from** `[0]` **to** `[10]` | `fa_random` | Chance | A random whole number in this range, both ends included. | `random.randint(0, 10)` (the generator swaps the ends if the first is bigger) |
| `[10]` **% chance** | `ic_chance` | Chance | (as Round 1) | `random.random() < 0.1` |

### Problems the generator reports (they block submit and never reach the engine)
- **send in the receiving section:** "Use 'send back' under 'when I'm receiving'." The same check covers the reverse case.
- **"what I received this turn" under sending:** "This only has a value when you're receiving." The block also gets a Blockly warning icon in place.
- **Empty slot:** "The send block needs a number. Drag one in from Numbers." There is a matching message for each slot.
- **Blocks over `block_limit`:** shown as today.

### Toolbox for Round 3

The toolbox has 20 blocks. Actions and value blocks come **pre-filled** (for example `send [5]` arrives with a number inside), so a beginner never sees an empty slot by default. The pre-filled number counts toward the limit.

### Starting examples

| Name | Description | Blocks |
|---|---|---|
| **Break Even** | Sends 5. When receiving, sends back exactly what was sent, so the sender never loses and you keep the bonus. | 3 |
| **Mirror** | Sends 10 while the opponent pays back at least what you sent last time, otherwise only 2. Sends back half. | 7 |
| **Grudger** | Sends 10 until the opponent ever sends back less than you sent, then sends nothing. Sends back half. | 5 |
| **Matcher** | Sends 10 the first time, then the opponent's average send. Sends back half. | 7 |

```text
Break Even:  sending   { }                                                         otherwise send 5
             receiving { send back (what the opponent sent last) }                 otherwise send back 50 %
Mirror:      sending   { if (what the opponent sent back last) is at least (my last send) then { send (10) } }
                                                                                   otherwise send 2
             receiving { }                                                         otherwise send back 50 %
Grudger:     sending   { if the opponent has ever sent back less than I sent then { send (0) } }
                                                                                   otherwise send 10
             receiving { }                                                         otherwise send back 50 %
Matcher:     sending   { if this is my first time sending then { send (10) }
                         send (opponent's average send) }                          otherwise send 5
             receiving { }                                                         otherwise send back 50 %
```

The generated `strategy` for each (the header above, with only the helpers it uses):

```python
# Break Even
def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        # If nothing above decided
        return legal_send(5)
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    return legal_return((opp_sent[-1] if opp_sent else 0), received)

# Mirror. On the first send both values are 0, so 0 >= 0 and it opens by trusting.
def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        if ((opp_returned[-1] if opp_returned else 0) >= (my_sent[-1] if my_sent else 0)):
            return legal_send(10)
        # If nothing above decided
        return legal_send(2)
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    # If nothing above decided
    return legal_return(received * 50 // 100, received)

# Grudger
def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        if ever_short_changed(my_sent, opp_returned):
            return legal_send(0)
        # If nothing above decided
        return legal_send(10)
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    # If nothing above decided
    return legal_return(received * 50 // 100, received)

# Matcher
def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        if len(my_sent) == 0:
            return legal_send(10)
        return legal_send(average(opp_sent))
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    # If nothing above decided
    return legal_return(received * 50 // 100, received)
```

In Matcher, the sending fallback is unreachable and is left out (every path already sends). The block still shows it.

**Block limit.** The examples use 3 to 7 blocks. A thoughtful Round 3 strategy (both sections, two or three conditions, some maths) comes to about 20 to 30 blocks, so **40 is enough. No backend change is needed.**

---

## 1.4 Round 2: Theatre of War

**Round 2 is unchanged.** It keeps the troop map ("◈ Place troops on the map" / "</> Write code") and has **no blocks**. `games.ts` keeps `blocks: false` for `theatre_of_war`.

---

## 1.5 "Start from this" (both rounds)

- A **Start from this** button opens a short list: name, one-line description and block count.
- Picking one loads it into the canvas, after "This replaces the blocks on your canvas" if the canvas has more than the strategy block. The team then edits and submits it as usual.
- **There is no one-click submit from an example.** Identical submissions tie, and ties are broken by a random draw. The list carries that note: "A starting point. Change it to make it yours: identical bots tie, and ties are a coin toss."
- Examples that don't fit the block limit are hidden (as `examplesFor` does today).

## 1.6 Input and field names

The generator and the tutorial checks (part 2) read these names from the saved layout. Existing blocks keep their current names.

| ID | Inputs (slots) | Fields |
|---|---|---|
| `ic_strategy` | `BODY` (statements) | `FALLBACK` (move) |
| `ic_if` | `IF0` (condition), `DO0` (statements) | |
| `controls_ifelse` | `IF0`, `DO0`, `ELSE` | |
| `logic_operation` | `A`, `B` | `OP` (`AND` / `OR`) |
| `logic_negate` | `BOOL` | |
| `ic_play`, `ic_opp_last`, `ic_opp_ever`, `ic_my_last` | | `MOVE` |
| `ic_opp_rate` | | `MOVE`, `OP`, `PERCENT` |
| `ic_chance` | | `PERCENT` |
| `fa_strategy` | `SEND`, `RECEIVE` (statements) | `SEND_DEFAULT` (0–10), `RETURN_PCT_DEFAULT` (0–100) |
| `fa_send`, `fa_return` | `AMOUNT` (number) | |
| `fa_return_pct` | | `PERCENT` |
| `fa_compare` | `A`, `B` | `OP` (`GT`, `LT`, `GTE`, `LTE`, `EQ`) |
| `fa_arith` | `A`, `B` | `OP` (`ADD`, `SUB`, `MUL`, `DIV`) |
| `fa_percent_of` | `X` | `PERCENT` |
| `fa_number` | | `NUM` |
| `fa_random` | | `FROM`, `TO` |
| `fa_opp_avg` | | `WHAT` (`SEND` / `RETURN_PCT`) |
| `fa_my_last` | | `WHAT` (`SEND` / `RETURN`) |

---

# Part 2: guided blocks tutorial

A short guided build for Round 1 and Round 3. Each round's tutorial builds a real strategy in about 5 minutes (Forgiving Tit for Tat in Round 1, Grudger in Round 3), which leaves time inside the 10-minute goal to change it and make it the team's own.

## 2.1 How it behaves (both rounds)

**When it starts**
- It starts by itself the first time a team opens **Build with blocks** in that round on this browser, if the canvas holds only the strategy block.
- After that it is never automatic. A **Guided tutorial** button in the blocks tab bar replays it.
- It is remembered per browser in `localStorage` under `dz.tutorial.<game>` (`done` or `skipped`). Every read and write is wrapped in try/catch. If storage fails, the tutorial still runs, it just may offer itself again.
- **Never auto-started under browser automation** (`navigator.webdriver`, as `RoundIntro.tsx` does). The **Guided tutorial** button still works there, so Playwright can test the tutorial by clicking it.
- It is never offered in Round 2, in **Write code**, or to a fallen team.

**Replaying over existing work**
- If the canvas has more than the strategy block, **Guided tutorial** first asks: "The tutorial starts on an empty strategy. Your blocks are kept, and you can put them back at the end."
- **Skip** or **Put my blocks back** at the end restores the saved layout. **Keep this** keeps the tutorial's result.

**The card**
- A card docked over the top right of the canvas. It is not a modal, so the canvas, toolbox and Python stay usable.
- It shows: "Step 2 of 7", the instruction (one or two short sentences), a hint line, **Back**, and **Skip tutorial**.
  - **Skip tutorial is always visible** on every step, including the last.
  - **Back** re-shows the previous card's text. It doesn't undo blocks.
- The card has `role="dialog"`, `aria-modal="false"` and `aria-labelledby` the step title. The step text is in an `aria-live="polite"` region, so a screen reader hears each new step.
  - Skip is a real button in the tab order.
  - Esc skips only while focus is inside the card, so it never interferes with Blockly.

**The highlight**
- The current target gets a 2px amber outline: a toolbox category (found through `toolboxitemid` on each category), a block (via Blockly's own highlight), the Python panel, or the Submit button (found through `data-tour` attributes, the same markers as part 3).
- The outline pulses slowly, and is a still outline under `prefers-reduced-motion`.

**How a step is checked**
- A pure function `tutorialProgress(game, layout, events)` in `src/workspace/blocks/tutorial.ts` returns the first step whose check is not yet met. It reads only the layout JSON, like `generate.ts`, so every check is unit-testable without Blockly.
- It runs on every workspace change, from the same `onChange` the editor already uses.
- When a check passes, the card shows "✓ Done" for 600 ms and moves on (instantly under reduced motion). Steps with nothing to build (marked *Read*) have a **Next** button instead.
- Progress follows the layout. If the team deletes a block an earlier step needed, the card goes back to that step with a hint, and it carries on again once it's put back.
- Each check comes with **targeted hints** for the common near-misses (wrong dropdown value, block in the wrong slot). They show in the hint line straight away, and a general hint shows after 20 seconds with no change.

**What it never does**
- It never locks or hides blocks, changes the toolbox, submits for the team, or bypasses problems and the block limit.
- Each tutorial uses at most 8 blocks, well inside `block_limit`.

**The submit step**
- It passes when a new version is created while the tutorial is open (the submissions query shows a newer version).
- If the window isn't open, it shows "Submit opens when the round's submission window does. Your strategy is saved here until then." and passes with **Finish**.

**The end card**
- It says the tutorial is done and points at **Start from this** for more ideas, with the tie reminder ("identical bots tie, and ties are a coin toss, so change it to make it yours").
- It shows **Keep this** / **Put my blocks back**. **Put my blocks back** appears only if the team replayed the tutorial over existing work.

Wording below is what appears on screen. *Highlight* is the outlined target. *Check* is the condition on the layout (names from section 1.6). `S` is the strategy block's statement input (`BODY` in Round 1, `SEND`/`RECEIVE` in Round 3), and a chain means the blocks linked through `next`.

---

## 2.2 Round 1 tutorial: build Forgiving Tit for Tat (7 steps)

**Step 1: Meet your strategy** *(Read)*
- **Says:** "This block is your bot. Every turn it reads from the top, and the first move it reaches is what it plays. Right now nothing is inside, so it always plays the move at the bottom: cooperate. The Python below is what the server runs."
- **Highlight:** the strategy block, then the Generated Python panel.
- **User does:** reads it and clicks **Next**.
- **Check:** Next was clicked.

**Step 2: Add a decision**
- **Says:** "Open **Logic** and drag **if … then** into your strategy block."
- **Highlight:** the Logic category, then the strategy block's `BODY` slot.
- **User does:** drags `ic_if` into the strategy.
- **Check:** the `BODY` chain of `ic_strategy` contains an `ic_if`. (`controls_ifelse` also passes, and from then on the steps refer to "then".)
- **Hints:**
  - The block is on the canvas but not inside: "Drop it inside the strategy block, under 'My strategy, every turn'."

**Step 3: What are you reacting to?**
- **Says:** "Open **Opponent** and drag **opponent betrayed last turn** into the gap after **if**."
- **Highlight:** the Opponent category, then the `if` block.
- **User does:** puts `ic_opp_last` in the `IF0` slot, with its dropdown on betrayed.
- **Check:** the `ic_if` in `BODY` has `IF0` = `ic_opp_last` with `MOVE` = `D`.
- **Hints:**
  - `MOVE` = `C`: "Almost: set the dropdown to **betrayed**."
  - The block is not in the slot: "Drop it into the hexagon-shaped gap after **if**."

**Step 4: Hit back**
- **Says:** "Open **Actions** and drag **play** into the **then** gap. Set it to **betray**. You've built Tit for Tat: be nice, but hit back."
- **Highlight:** the Actions category, then the `if` block.
- **User does:** puts `ic_play` in `DO0`, with `MOVE` = `D`.
- **Check:** that `ic_if`'s `DO0` chain contains `ic_play` with `MOVE` = `D`.
- **Hints:**
  - `MOVE` = `C`: "Set it to **betray**, so a betrayal gets a betrayal back."
  - `ic_play` under the `if` instead of inside it: "Put it inside the **then** gap, so it only plays when the opponent betrayed."

**Step 5: Read your Python** *(Read)*
- **Says:** "Look at the Python. `opp_history[-1] == "D"` means 'the opponent's last move was betray', and `return "D"` plays betray. The last line, `return "C"`, is your fallback: it plays whenever nothing above decided, including the first turn."
- **Highlight:** the Python panel.
- **User does:** reads it and clicks **Next**.
- **Check:** Next was clicked.

**Step 6: Make it forgiving**
- **Says:** "Two Tit for Tats can feud forever. Open **Chance**, drag **10 % chance** onto the canvas, put it in a new **if … then** with **play cooperate** inside, and place that above **play betray**."
- **Highlight:** the Chance category, then the existing `if` block's `DO0`.
- **User does:** builds `if 10 % chance then play cooperate` inside the outer `if`, before `play betray`.
- **Check:** the outer `ic_if`'s `DO0` chain has an `ic_if` or `controls_ifelse` whose `IF0` is `ic_chance` and whose `DO0` holds `ic_play` `C`, and an `ic_play` `D` still reaches after it. (`controls_ifelse` with `play betray` in `ELSE` also passes.) Any `PERCENT` from 1 to 50 passes.
- **Hints:**
  - The chance block is placed after `play betray`: "Move it above **play betray**. Blocks under a play block never run."
  - `PERCENT` > 50: "That forgives most betrayals. Try something like 10."

**Step 7: Send it**
- **Says:** "No problems, so you're ready. Press **Submit strategy**. The server tests your bot against sample bots and shows the results in **Latest version**."
- **Highlight:** the Submit button (`data-tour="submit"`).
- **User does:** submits.
- **Check:** a new version appears, or the window is closed (see 2.1).

The finished layout has 7 blocks: strategy, two ifs, opponent betrayed, 10 % chance, play cooperate, play betray. The fallback is a field, not a block. That is within 40.

---

## 2.3 Round 3 tutorial: build Grudger (7 steps)

**Step 1: Two jobs, taking turns** *(Read)*
- **Says:** "In Foreign Aid you take turns. When you're **sending**, you choose 0 to 10 to send, and it arrives tripled. When you're **receiving**, you choose how much of that to send back. Your strategy has a section for each. Whatever number you build, the game's limits are kept for you."
- **Highlight:** the "when I'm sending" section, then the "when I'm receiving" section.
- **User does:** reads it and clicks **Next**.
- **Check:** Next was clicked.

**Step 2: Start by trusting**
- **Says:** "At the bottom of **when I'm sending**, change **send 5** to **send 10**. With nothing else inside, your bot now sends 10 every time."
- **Highlight:** the `SEND_DEFAULT` field.
- **User does:** sets it to 10.
- **Check:** `fa_strategy.SEND_DEFAULT` = 10.
- **Hints:**
  - Changed in the receiving section instead: "That's the receiving fallback. Change the one under **when I'm sending**."

**Step 3: Add a decision**
- **Says:** "Open **Logic** and drag **if … then** into **when I'm sending**."
- **Highlight:** the Logic category, then the `SEND` slot.
- **User does:** drags `ic_if` into `SEND`.
- **Check:** the `SEND` chain contains `ic_if` (or `controls_ifelse`).
- **Hints:**
  - Dropped in `RECEIVE`: "That's the receiving section. Drag it up into **when I'm sending**."

**Step 4: Remember who cheated you**
- **Says:** "Open **Opponent** and drag **the opponent has ever sent back less than I sent** into the gap after **if**."
- **Highlight:** the Opponent category, then the `if` block.
- **User does:** puts `fa_opp_ever_short` in `IF0`.
- **Check:** that `if`'s `IF0` is `fa_opp_ever_short`.
- **Hints:**
  - Another Opponent block is in the slot: "Close, but this step needs **has ever sent back less than I sent**."

**Step 5: Stop trusting them**
- **Says:** "Open **Actions** and drag **send** into the **then** gap. Change its number to **0**. That's Grudger: trust fully until you're cheated once."
- **Highlight:** the Actions category, then the `if` block.
- **User does:** puts `fa_send` in `DO0`, with an `AMOUNT` of `fa_number` `NUM` = 0.
- **Check:** `DO0` contains `fa_send` whose `AMOUNT` is `fa_number` with `NUM` = 0.
- **Hints:**
  - **send back** used instead: "When sending, use **send**. **Send back** is for the receiving section."
  - `NUM` ≠ 0: "Set the number to 0, so a cheater gets nothing."

**Step 6: Be fair when receiving**
- **Says:** "Now **when I'm receiving**. From **Actions**, drag **send back** into it. Then, from **Opponent**, drop **what the opponent sent last** over its number. Sending back what they sent means they never lose by trusting you, and you keep the rest."
- **Highlight:** the `RECEIVE` slot, then the Actions and Opponent categories.
- **User does:** builds `send back (what the opponent sent last)` in `RECEIVE`.
- **Check:** the `RECEIVE` chain contains `fa_return` whose `AMOUNT` is `fa_opp_sent_last`, or `fa_return_pct` with `PERCENT` ≥ 34 (the "they don't lose" level, which is also accepted).
- **Hints:**
  - `fa_send` in `RECEIVE`: the generator's own problem text, "Use 'send back' under 'when I'm receiving'."
  - The number is still there: "Drop **what the opponent sent last** right on top of the number to swap it in."

**Step 7: Send it**
- Same as Round 1 step 7. The Python panel is highlighted briefly first, with: "Every amount goes through `legal_send` or `legal_return`, so your bot can never break the rules."

The finished layout has 7 blocks: strategy, if, has ever short-changed, send, 0, send back, opponent sent last. That is within 40.

---

## 2.4 Files and tests

**New files** (in Nithya's area):
- `src/workspace/blocks/tutorial.ts`: step definitions and the `tutorialProgress` checks, pure.
- `src/workspace/blocks/TutorialCard.tsx`: the card and the highlight.

**`Workspace.tsx`** needs small changes:
- mount the card in blocks mode;
- the **Guided tutorial** button;
- `data-tour="submit"` and `data-tour="python"`.

**`BlockEditor.tsx`** exposes the workspace so the tutorial can highlight blocks and toolbox categories.

**Unit tests** for `tutorialProgress`:
- for each step: passing layouts, each near-miss with its hint, and going back after a deletion;
- every finished tutorial layout generates Python with no problems;
- for Round 3, the result plays legal moves (the generated Python is checked in the engine simulation from Step 1).

**Playwright** (one test per round):
- click **Guided tutorial**;
- drive each step by loading layouts;
- check that Skip restores the previous layout;
- check that nothing auto-starts under automation.

---

# Part 3: app-wide tour

A short pointer tour for each screen, so a first-time user knows where things are. It explains the screen, not the game. The game is taught by the round intro, the Round rules panel and the blocks tutorial.

## 3.1 Library: driver.js (recommended)

| | driver.js | Reactour (`@reactour/tour`) |
|---|---|---|
| Licence | MIT | MIT |
| Dependencies | none | `@reactour/mask`, `popover`, `utils`, then `@rooks/use-mutation-observer` and `resize-observer-polyfill` |
| React 19 | not React-bound, so no peer-version risk | peer `react 16–19` |
| Fit | highlight plus popover, keyboard control, `animate` and `smoothScroll` switches, hooks on each step | provider and context around the app, which means changing `App.tsx` structure |
| Last release | 1.11.0 on 2026-11-08 | 3.8.0 on 2025-05-07 |

**Recommendation: driver.js, pinned to exactly `1.10.2`** (released 2026-10-18).
- Don't take 1.11.0 yet: it came out two days ago. Move up once it has had a couple of weeks.
- It's one small dependency with no transitive packages and no provider to wrap around `App.tsx`.
- No AGPL code: confirm the licence again at install with `npm view driver.js@1.10.2 license` (it's MIT today).

## 3.2 How the tour behaves

**Who sees it**
- A screen's tour starts the first time that screen is shown on this browser, and only once the screen has finished loading.
- **Login:** anyone.
- **Claim:** a team that hasn't claimed.
- **Workspace:** a team.
- **War map and Command Console:** organisers only.
- **Never for spectators:** the Big Board runs on a projector, and a popover there would be shown to the whole room.

**When it waits.** A tour never starts while any of these is up:
- the round intro (`RoundIntro`);
- a confirm dialog;
- a loading or error state.

It starts once the screen is idle.

**Skip and Replay**
- Each popover shows **Back**, **Next** (or **Done** on the last step), and a text button **Skip tour**, which is always visible. driver.js's own × is replaced with this button through `onPopoverRender`, so the word "Skip" is always on screen.
- Esc also skips. Arrow keys move between steps (`allowKeyboardControl`).
- **Replay:**
  - signed-in screens get a **Tour** button in the top bar (`App.tsx`, next to Log out);
  - the login screen gets a small "Show me around" link under the form.
  - Replay runs the tour for the screen currently shown.

**Remembered per browser**
- Stored in `localStorage` under `dz.tour.v1.<screen>` (`done` or `skipped`). Every read and write is wrapped in try/catch.
- If storage fails, the tour may be offered again, and nothing breaks.
- `v1` lets a future redesign show the tours again.

**Browser automation**
- Never shown by itself when `navigator.webdriver` is true, using the same check as `RoundIntro.tsx`.
- **Replay** is a deliberate click, so it still works and Playwright can test it.
- Existing e2e tests see no tour and need no changes.

**Reduced motion**
- Under `prefers-reduced-motion: reduce`, it starts driver.js with `animate: false` and `smoothScroll: false`, so popovers appear in place and the page jumps to the target.

**It never acts on the app**
- `disableActiveInteraction: true` on every step, so a click during the tour can't open a round, claim a nation or submit.
- Targets are found by `data-tour` attributes, never by class names.
- A step whose target isn't on screen is left out before the tour starts (for example, the blocks tabs in Round 2). A tour with no steps left doesn't start.

**Accessibility**
- The popover gets `role="dialog"` and an `aria-live="polite"` step region, through `onPopoverRender`.
- Focus moves into the popover, and returns to where it was when the tour ends.
- Popovers sit on the target's best side and fall back to below it at phone width.

**Look**
- `popoverClass: "dz-tour"`, styled in a new `src/tour/tour.css`: the paper-sheet card, Special Elite labels and amber highlight used elsewhere. AA contrast.

**Ordering with the blocks tutorial**
- In the workspace, the screen tour runs first. The blocks tutorial (part 2) waits until it's done or skipped before it may start.

**Code layout**
- A new folder, `src/tour/`:
  - `steps.ts`: steps per screen, as data;
  - `tour.ts`: start, storage, guards;
  - `useTour.ts`: hook a screen calls with its name and a "ready" flag;
  - `tour.css`.
- Kept out of `src/components/`, so the shared folder doesn't change.

## 3.3 Screens and steps

Text is as shown in the popover. The target is the `data-tour` marker.

### Login (3 steps)
1. **`login-fields`**: "Sign in with the username and password the organisers gave your team."
2. **`login-submit`**: "Request Clearance signs you in. Your team picks its nation next."
3. **`login-bigboard`**: "Just watching? The Big Board shows the live war map without signing in."

### Claim your nation (4 steps)
1. **`claim-form`**: "Name your nation here. Names are unique, and you can't change it later."
2. **`claim-list`**: "Pick a free territory from the list, or search for one."
3. **`claim-map`**: "Or click a country on the map. Taken territories are marked."
4. **`claim-submit`**: "Claim it when you're sure. The choice is final for the whole event."

### Team workspace (6 steps)
1. **`topbar-clock`**: "The round and its countdown. When the window closes, your latest accepted version plays."
2. **`play-mode`**: "Choose how to build: blocks or code (in Round 2, the troop map or code). Whichever tab is open is what you submit."
3. **`examples`**: "Stuck? Start from this loads a ready-made strategy for you to change. Identical bots tie, and ties are a coin toss, so make it yours." *(Not in Round 2.)*
4. **`python`**: "The Python your blocks make. It's exactly what the server runs." *(Blocks mode only.)*
5. **`submit`**: "Submit sends your strategy. You can submit as often as you like while the window is open."
6. **`results`**: "Test results against sample bots land here, and every version you've sent is kept below."

### War map (organisers, 4 steps)
1. **`warmap-round`**: "The current round and DEFCON level."
2. **`warmap-map`**: "Every claimed nation on the map, with its status."
3. **`warmap-board`**: "Standings appear here once a round is published."
4. **`warmap-clock`**: "Server time. Every window and countdown runs on it."

### Command Console (organisers, 5 steps)
1. **`ops-order`**: "This round's orders: its game, window times and status, stamped as it moves along."
2. **`ops-controls`**: "Round Control shows only the actions this round allows: open, extend, start, retry or publish."
3. **`ops-timer`**: "The window timer. Teams see the same countdown."
4. **`ops-roster`**: "Every team and its latest submission. Check that most are accepted before you start the round."
5. **`ops-unclaimed`**: "Team accounts that haven't claimed a nation yet. Chase these before Round 1 opens."

## 3.4 Files that need `data-tour` markers

These are attribute-only changes: no logic or styling changes, plus one hook call per screen to start its tour.

| File | Owner | Markers |
|---|---|---|
| `src/workspace/auth/Login.tsx` | Sumedh | `login-fields` (the wrapper around username and password), `login-submit`, `login-bigboard`; the "Show me around" link |
| `src/workspace/auth/ClaimCountry.tsx` | Sumedh | `claim-form` (the form header), `claim-list` (a wrapper inside the "Available territories" Panel, so `Panel` in `ui.tsx` needn't change), `claim-map`, `claim-submit` |
| `src/workspace/editor/Workspace.tsx` | Nithya | `play-mode` (the tab bar), `examples` (Start from this), `python`, `submit`, `results` (around Latest version and Version history) |
| `src/warmap/WarMap.tsx` | Nithya | `warmap-round` (`.warmap__round`), `warmap-map` (`section.warmap__map`), `warmap-board` (`aside.warmap__board`), `warmap-clock` (`.warmap__clock`) |
| `src/workspace/organiser/OrganiserConsole.tsx` | Nithya | `ops-order` (the orders `article`), `ops-controls` (the control `section`), `ops-timer` (the `console-timer` plate), `ops-roster`, `ops-unclaimed` (wrapper around `UnclaimedPanel`) |
| `src/app/App.tsx` | **shared: coordination needed** | `topbar-clock` (the countdown group), and the new **Tour** button next to Log out |

**Dependency:** add `driver.js` `1.10.2` to `package.json`. That is a shared file, so tell the others first.

**Tests**
- Unit (`src/tour/tour.test.ts`):
  - storage keys and try/catch failure;
  - nothing starts by itself under `navigator.webdriver`;
  - nothing for spectators;
  - missing targets are left out;
  - the reduced-motion options.
- Playwright: the **Tour** button on the workspace and the console runs each step and Skip, and a second visit shows nothing.
