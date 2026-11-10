"""Test helper for generate.test.ts: plays block-generated Foreign Aid bots in the engine.

Run as: python3 -I play_foreign_aid.py <repo root>, with JSON on stdin:
    {"bots": [code, ...], "turns": 200, "seeds": [1, 2]}

Each bot is loaded with the engine's own loader (engine/sandbox.py load_bot, the server's checks and
builtins) and plays every sample bot in engine/foreign_aid_strategies.py, and a second copy of itself,
from both seats. Matches run with guard=True, so the engine's own ForeignAidGame.validate_action checks
every amount, and an invalid move or a crash ends the match as a forfeit. Every amount the block bot
returns is also checked here: a plain int, from 0 to 10 when sending, from 0 to 3 times what was sent
when receiving.

Prints one JSON result per bot: {"calls", "problems"}, or {"error"} if it would not load.
Only reads engine/; never changes it.
"""

import json
import sys

sys.path.insert(0, sys.argv[1])

from engine.foreign_aid_strategies import FOREIGN_AID_BOTS  # noqa: E402
from engine.games import FOREIGN_AID  # noqa: E402
from engine.match import play_match  # noqa: E402
from engine.sandbox import load_bot  # noqa: E402

ENDOWMENT, MULTIPLIER = 10, 3


def recorded(bot, calls, problems, label):
    """The bot, with every amount it returns checked against the rules."""

    def play(my_history, opp_history):
        move = bot(my_history, opp_history)
        calls[0] += 1
        if len(opp_history) == len(my_history):
            role, top = "send", ENDOWMENT
        else:
            role, top = "send back", MULTIPLIER * opp_history[-1]
        if type(move) is not int or not 0 <= move <= top:
            problems.append(f"{label}: {role} {move!r} on turn {len(my_history)}, allowed 0 to {top}")
        return move

    return play


def main():
    job = json.load(sys.stdin)
    out = []
    for index, code in enumerate(job["bots"]):
        calls, problems = [0], []
        try:
            opponents = dict(FOREIGN_AID_BOTS)
            opponents["itself"] = load_bot(code, random_seed=10_000 + index)
            for name, opponent in opponents.items():
                for seed in job["seeds"]:
                    for seat in (0, 1):
                        label = f"vs {name}, seat {seat + 1}, seed {seed}"
                        mine = recorded(load_bot(code, random_seed=seed), calls, problems, label)
                        bots = (mine, opponent) if seat == 0 else (opponent, mine)
                        result = play_match(*bots, FOREIGN_AID, job["turns"], seed=seed, guard=True)
                        if result["forfeit"]:
                            problems.append(f"{label}: engine forfeit, side {result['forfeit']['side'] + 1}: {result['forfeit']['reason']}")
                        elif len(result["history1"]) != job["turns"]:
                            problems.append(f"{label}: only {len(result['history1'])} turns played")
            out.append({"calls": calls[0], "problems": problems[:5]})
        except Exception as error:  # a bot that won't load is reported, not raised
            out.append({"error": f"{type(error).__name__}: {error}"})
    print(json.dumps(out))


main()
