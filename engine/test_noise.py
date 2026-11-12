import pytest

from engine.games import FOREIGN_AID, PRISONERS_DILEMMA, THEATRE_OF_WAR
from engine.match import play_match
from engine.noise import DEFAULT_NOISE, apply_noise
from engine.sandbox import play_safe_match


class SequenceRng:
    def __init__(self, values):
        self.values = iter(values)
        self.calls = 0

    def random(self):
        self.calls += 1
        return next(self.values)


def test_default_prisoners_dilemma_noise_is_five_percent():
    assert DEFAULT_NOISE == 0.05


@pytest.mark.parametrize(("move", "expected"), [("C", "D"), ("D", "C")])
def test_noise_can_flip_cooperation_and_betrayal(move, expected):
    assert apply_noise(move, ("C", "D"), DEFAULT_NOISE, SequenceRng([0.049])) == expected


def test_zero_noise_never_changes_actions_or_draws_randomness():
    rng = SequenceRng([])

    assert apply_noise("C", ("C", "D"), 0, rng) == "C"
    assert apply_noise("D", ("C", "D"), 0, rng) == "D"
    assert rng.calls == 0


@pytest.mark.parametrize(
    "noise", [-0.01, 1.01, float("nan"), float("inf"), -float("inf")],
)
def test_invalid_noise_probabilities_are_rejected(noise):
    with pytest.raises(ValueError, match="noise must be between 0 and 1"):
        apply_noise("C", ("C", "D"), noise, SequenceRng([]))


@pytest.mark.parametrize("noise", [True, "0.05", None])
def test_non_numeric_noise_probabilities_are_rejected(noise):
    with pytest.raises(TypeError, match="noise must be a number"):
        apply_noise("C", ("C", "D"), noise, SequenceRng([]))


@pytest.mark.parametrize("noise", [-0.01, 1.01])
def test_match_rejects_out_of_range_noise_even_without_turns(noise):
    with pytest.raises(ValueError, match="noise must be between 0 and 1"):
        play_match(lambda *_: "C", lambda *_: "C", PRISONERS_DILEMMA, 0, noise=noise)


def test_each_prisoners_dilemma_action_uses_an_independent_noise_draw():
    rng = SequenceRng([0.01, 0.5])

    played1 = apply_noise("C", ("C", "D"), DEFAULT_NOISE, rng)
    played2 = apply_noise("C", ("C", "D"), DEFAULT_NOISE, rng)

    assert (played1, played2) == ("D", "C")
    assert rng.calls == 2


def test_default_noise_is_applied_independently_to_match_players():
    cooperate = lambda my_history, opp_history: "C"

    result = play_match(cooperate, cooperate, PRISONERS_DILEMMA, 1, seed=31)

    assert result["history1"] == ["D"]
    assert result["history2"] == ["C"]
    assert (result["score1"], result["score2"]) == (5, 0)


def test_sandbox_match_uses_default_prisoners_dilemma_noise():
    cooperate = "def strategy(my_history, opp_history):\n    return 'C'\n"
    result = play_safe_match(
        "first", "second", {"first": cooperate, "second": cooperate},
        PRISONERS_DILEMMA, 1, seed=21,
    )

    assert result["history1"] == ["D"]
    assert result["history2"] == ["C"]
    assert (result["score1"], result["score2"]) == (5, 0)


def test_seeded_noise_is_reproducible():
    cooperate = lambda my_history, opp_history: "C"

    first = play_match(cooperate, cooperate, PRISONERS_DILEMMA, 20, seed=17)
    second = play_match(cooperate, cooperate, PRISONERS_DILEMMA, 20, seed=17)

    assert first == second


@pytest.mark.parametrize(
    ("game", "strategy", "turns"),
    [
        (THEATRE_OF_WAR, lambda my_history, opp_history: [20] * 5, 1),
        (FOREIGN_AID, lambda my_history, opp_history: 0, 2),
    ],
)
def test_default_noise_does_not_change_other_games(game, strategy, turns):
    default = play_match(strategy, strategy, game, turns, seed=31)
    zero_noise = play_match(strategy, strategy, game, turns, noise=0, seed=31)

    assert default == zero_noise
