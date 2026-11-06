import time

import pytest

from engine.games import PRISONERS_DILEMMA
from engine.match import play_match
from engine.sandbox import load_bot, run_safe_round_robin, validate_code
from engine.sandbox import test_submission as check_submission
from engine.strategies import (
    BUILT_IN_BOTS, always_cooperate, always_defect, random_bot, tit_for_tat,
)
from engine.tournament import run_round_robin, summarize


def test_tit_for_tat_vs_always_defect():
    result = play_match(tit_for_tat, always_defect, PRISONERS_DILEMMA, turns=10)
    assert (result["score1"], result["score2"]) == (9, 14)


def test_always_cooperate_vs_always_defect():
    result = play_match(always_cooperate, always_defect, PRISONERS_DILEMMA, turns=10)
    assert (result["score1"], result["score2"]) == (0, 50)


def test_round_robin_one_entry_per_bot():
    result = run_round_robin(BUILT_IN_BOTS, PRISONERS_DILEMMA, turns=20, repetitions=2)
    names = [row["name"] for row in result["leaderboard"]]
    assert sorted(names) == sorted(BUILT_IN_BOTS)


def test_seed_makes_random_bot_repeatable():
    first = play_match(random_bot, tit_for_tat, PRISONERS_DILEMMA, turns=50, seed=42)
    second = play_match(random_bot, tit_for_tat, PRISONERS_DILEMMA, turns=50, seed=42)
    assert first["history1"] == second["history1"]
    assert first["history2"] == second["history2"]


def test_self_play_scores():
    bots = {"tit_for_tat": tit_for_tat, "always_defect": always_defect}
    result = run_round_robin(bots, PRISONERS_DILEMMA, turns=200, repetitions=1)
    assert result["matrix"]["tit_for_tat"]["tit_for_tat"] == 600
    assert result["matrix"]["always_defect"]["always_defect"] == 200


# --- Seeds ------------------------------------------------------------------

def test_round_robin_seed_is_repeatable():
    first = run_round_robin(BUILT_IN_BOTS, PRISONERS_DILEMMA, turns=50, repetitions=2, seed=7)
    second = run_round_robin(BUILT_IN_BOTS, PRISONERS_DILEMMA, turns=50, repetitions=2, seed=7)
    assert first == second


# --- Sandbox ----------------------------------------------------------------

COPYCAT = """
import random

def strategy(my_history, opp_history):
    return opp_history[-1] if opp_history else "AID"
"""

BAD_MOVE = """
def strategy(my_history, opp_history):
    return "X"
"""

INFINITE_LOOP = """
def strategy(my_history, opp_history):
    while True:
        pass
"""

# Cooperates only while its counter matches its own history, so shared
# state between two copies would make it defect.
STATEFUL = """
count = 0

def strategy(my_history, opp_history):
    global count
    count += 1
    return "AID" if count == len(my_history) + 1 else "WITHHOLD"
"""


def test_valid_bot_loads_and_plays():
    assert validate_code(COPYCAT) == []
    bot = load_bot(COPYCAT)
    result = play_match(bot, always_defect, PRISONERS_DILEMMA, turns=10)
    assert (result["score1"], result["score2"]) == (9, 14)


def test_import_os_rejected():
    errors = validate_code("import os\n\ndef strategy(my_history, opp_history):\n    return 'C'\n")
    assert any("os" in e for e in errors)
    with pytest.raises(ValueError):
        load_bot("import os\n\ndef strategy(my_history, opp_history):\n    return 'C'\n")


def test_bad_move_forfeits_and_is_disqualified():
    result = run_safe_round_robin({"bad": BAD_MOVE, "copycat": COPYCAT},
                                  PRISONERS_DILEMMA, turns=10, repetitions=1)
    assert result["disqualified"] == ["bad"]
    assert [row["name"] for row in result["leaderboard"]] == ["copycat"]
    assert result["matrix"] == {"copycat": {"copycat": 30}}  # only self-play left
    assert {f["bot"] for f in result["forfeits"]} == {"bad"}
    assert "Invalid Prisoner's Dilemma move 'X'" in result["forfeits"][0]["reason"]


def test_infinite_loop_forfeits_and_tournament_finishes():
    start = time.monotonic()
    result = run_safe_round_robin({"loop": INFINITE_LOOP},
                                  PRISONERS_DILEMMA, turns=20, repetitions=1)
    assert result["disqualified"] == ["loop"]
    assert result["leaderboard"] == []
    loop_forfeits = [f for f in result["forfeits"] if f["bot"] == "loop"]
    assert len(loop_forfeits) == 1
    assert all("timed out" in f["reason"] for f in loop_forfeits)
    assert time.monotonic() - start < 20


def test_stateful_bot_has_independent_state_in_self_play():
    result = run_safe_round_robin({"stateful": STATEFUL},
                                  PRISONERS_DILEMMA, turns=50, repetitions=1)
    assert result["matrix"]["stateful"]["stateful"] == 150  # cooperated every turn
    assert result["forfeits"] == []


def test_safe_round_robin_seed_is_repeatable():
    bots = {"copycat": COPYCAT, "stateful": STATEFUL}
    first = run_safe_round_robin(bots, PRISONERS_DILEMMA, turns=50, repetitions=2, seed=7)
    second = run_safe_round_robin(bots, PRISONERS_DILEMMA, turns=50, repetitions=2, seed=7)
    assert first["leaderboard"] == second["leaderboard"]


def test_submission_accepts_good_bot():
    result = check_submission(COPYCAT)
    assert result["error"] is None
    assert len(result["test_results"]) == len(BUILT_IN_BOTS)


def test_submission_rejects_bad_bots():
    invalid = check_submission("import os\n\ndef strategy(my_history, opp_history):\n    return 'C'\n")
    assert "os" in invalid["error"]
    assert invalid["test_results"] == []

    crashing = check_submission("def strategy(my_history, opp_history):\n    return opp_history[0]\n")
    assert "Against tit_for_tat: Your bot raised IndexError: list index out of range (line 2)" in crashing["error"]
    assert len(crashing["test_results"]) == len(BUILT_IN_BOTS)
    looping = check_submission(INFINITE_LOOP)
    assert "timed out" in looping["error"]


def test_submission_testing_is_game_aware():
    from engine.games import BLOTTO, TRUST
    assert "game rules are pending" in check_submission(COPYCAT, TRUST)["error"]
    result = check_submission(
        "def strategy(my_history, opp_history):\n    return [3, 3, 2, 2]\n",
        BLOTTO,
        turns=2,
    )
    assert result["error"] is None
    assert len(result["test_results"]) == 5
    wrong_game_move = check_submission(COPYCAT, BLOTTO, turns=2)
    assert "Invalid Colonel Blotto allocation" in wrong_game_move["error"]
    invalid_game = check_submission(COPYCAT, False, turns=2)
    assert "Expected a game key" in invalid_game["error"]


def test_sandbox_rejects_moves_from_another_game():
    from engine.games import BLOTTO

    pd_move_in_blotto = "def strategy(my_history, opp_history):\n    return 'AID'\n"
    valid_blotto = (
        "def strategy(my_history, opp_history):\n"
        "    return [3, 3, 2, 2]\n"
    )
    result = run_safe_round_robin(
        {"bad": pd_move_in_blotto, "good": valid_blotto},
        BLOTTO,
        turns=1,
        include_self_play=False,
    )
    assert result["disqualified"] == ["bad"]
    assert "Invalid Colonel Blotto allocation" in result["matches"][0]["forfeit_reason"]


def test_invalid_blotto_allocation_is_a_forfeit_not_a_scored_move():
    from engine.games import BLOTTO

    invalid_blotto = (
        "def strategy(my_history, opp_history):\n"
        "    return [10, 0, 0]\n"
    )
    valid_blotto = (
        "def strategy(my_history, opp_history):\n"
        "    return [3, 3, 2, 2]\n"
    )
    result = run_safe_round_robin(
        {"bad": invalid_blotto, "good": valid_blotto},
        BLOTTO,
        turns=2,
        include_self_play=False,
    )
    match = result["matches"][0]
    assert match["status"] == "forfeited"
    assert match["forfeit_side"] == 0
    assert match["score_a"] == 0
    assert match["score_b"] == BLOTTO.forfeit_credit(2)
    assert not match["counted"]
    assert result["disqualified"] == ["bad"]


def test_leaderboard_orders_by_team_id_but_ranks_by_total_only():
    result = summarize([9, 2, 5], [(2, 5, 10, 10), (2, 9, 10, 0), (5, 9, 0, 10)], 1, 1)
    rows = {row["name"]: row for row in result["leaderboard"]}
    assert [row["name"] for row in result["leaderboard"]] == [2, 5, 9]
    assert rows[2]["rank"] == 1
    assert rows[5]["rank"] == rows[9]["rank"] == 2


def test_only_approved_game_keys_are_available():
    from engine.games import GAMES
    assert tuple(GAMES) == ("prisoners_dilemma", "blotto", "trust")
