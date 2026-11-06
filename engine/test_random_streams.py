import random

from engine.games import PRISONERS_DILEMMA
from engine.match import play_match
from engine.sandbox import run_safe_round_robin


def random_move(my_history, opp_history):
    return random.choice(("AID", "WITHHOLD"))


def reseeding_move(my_history, opp_history):
    random.seed(12345)
    for _ in range(100):
        random.random()
    return "AID"


def consuming_move(my_history, opp_history):
    for _ in range(100):
        random.random()
    return "AID"


def test_bot_reseeding_does_not_change_the_other_random_stream():
    baseline = play_match(
        consuming_move, random_move, PRISONERS_DILEMMA, turns=40, seed=99,
    )
    reseeded = play_match(
        reseeding_move, random_move, PRISONERS_DILEMMA, turns=40, seed=99,
    )
    assert baseline["history2"] == reseeded["history2"]


def test_seeded_random_streams_are_repeatable():
    first = play_match(random_move, random_move, PRISONERS_DILEMMA, 40, seed=17)
    second = play_match(random_move, random_move, PRISONERS_DILEMMA, 40, seed=17)
    assert first["history1"] == second["history1"]
    assert first["history2"] == second["history2"]


def test_sandbox_bot_cannot_reseed_another_submissions_random_stream():
    reseeder = (
        "import random\n"
        "def strategy(my_history, opp_history):\n"
        "    random.seed(12345)\n"
        "    for _ in range(100): random.random()\n"
        "    return 'AID'\n"
    )
    random_code = (
        "import random\n"
        "def strategy(my_history, opp_history):\n"
        "    return 'AID' if random.random() < 0.5 else 'WITHHOLD'\n"
    )
    plain = "def strategy(my_history, opp_history):\n    return 'AID'\n"

    def random_history(opponent):
        result = run_safe_round_robin(
            {1: opponent, 2: random_code},
            PRISONERS_DILEMMA,
            turns=40,
            seed=2026,
            include_self_play=False,
        )
        return result["matches"][0]

    baseline = random_history(plain)
    reseeded = random_history(reseeder)
    assert baseline["score_b"] == reseeded["score_b"]
