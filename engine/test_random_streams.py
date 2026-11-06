import random

from engine.games import PRISONERS_DILEMMA
from engine.match import play_match
from engine.sandbox import run_safe_round_robin


def random_move(my_history, opp_history):
    return random.choice(("C", "D"))


def reseeding_move(my_history, opp_history):
    random.seed(12345)
    for _ in range(100):
        random.random()
    return "C"


def consuming_move(my_history, opp_history):
    for _ in range(100):
        random.random()
    return "C"


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
        "    return 'C'\n"
    )
    random_code = (
        "import random\n"
        "def strategy(my_history, opp_history):\n"
        "    return 'C' if random.random() < 0.5 else 'D'\n"
    )
    plain = "def strategy(my_history, opp_history):\n    return 'C'\n"

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
