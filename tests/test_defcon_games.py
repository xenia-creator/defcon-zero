import inspect

import pytest

from engine.blotto_strategies import BLOTTO_BOTS, EVEN_SPLIT
from engine.games import BLOTTO, GAMES, PRISONERS_DILEMMA, TRUST
from engine.match import play_match
from engine.noise import apply_noise
from engine.registry import REGISTRY, bots_for, play_registered
from engine.strategies import BUILT_IN_BOTS, adaptive_aid, always_cooperate, always_defect
from engine.tournament import run_round_robin


def allocation_bot(allocation):
    return lambda my_history, opp_history: list(allocation)


def test_game_catalog_uses_only_the_three_contract_keys():
    assert tuple(GAMES) == ("prisoners_dilemma", "blotto", "trust")
    assert (PRISONERS_DILEMMA.key, BLOTTO.key, TRUST.key) == tuple(GAMES)


def test_prisoners_dilemma_uses_aid_withhold_and_keeps_its_payoff_matrix():
    assert PRISONERS_DILEMMA.actions == ("AID", "WITHHOLD")
    assert PRISONERS_DILEMMA.payoffs == {
        ("AID", "AID"): (3, 3),
        ("AID", "WITHHOLD"): (0, 5),
        ("WITHHOLD", "AID"): (5, 0),
        ("WITHHOLD", "WITHHOLD"): (1, 1),
    }


@pytest.mark.parametrize(
    ("move1", "move2", "expected"),
    [
        ("AID", "AID", (3, 3)),
        ("AID", "WITHHOLD", (0, 5)),
        ("WITHHOLD", "AID", (5, 0)),
        ("WITHHOLD", "WITHHOLD", (1, 1)),
    ],
)
def test_prisoners_dilemma_scores_every_payoff_cell(move1, move2, expected):
    assert PRISONERS_DILEMMA.score(move1, move2) == expected


def test_adaptive_aid_uses_the_majority_of_the_last_five_moves():
    assert adaptive_aid([], []) == "AID"
    assert adaptive_aid([], ["WITHHOLD", "AID", "AID", "AID", "WITHHOLD"]) == "AID"
    assert adaptive_aid([], ["AID", "AID", "WITHHOLD", "WITHHOLD", "WITHHOLD"]) == "WITHHOLD"
    assert adaptive_aid([], ["AID"] * 5 + ["WITHHOLD"] * 5) == "WITHHOLD"
    assert BUILT_IN_BOTS["adaptive_aid"] is adaptive_aid


def test_pd_noise_flips_actions_and_records_the_scored_history():
    result = play_match(always_cooperate, always_defect, PRISONERS_DILEMMA, 5, noise=1)
    assert result["history1"] == ["WITHHOLD"] * 5
    assert result["history2"] == ["AID"] * 5
    assert (result["score1"], result["score2"]) == (25, 0)


def test_noise_zero_does_not_consume_randomness():
    class UnexpectedRandom:
        def random(self):
            raise AssertionError("zero noise must not draw from the random stream")

    assert apply_noise("AID", PRISONERS_DILEMMA.actions, 0, UnexpectedRandom()) == "AID"


def test_histories_are_oldest_first_copies_and_cannot_be_mutated_by_bots():
    seen = []

    def watcher(my_history, opp_history):
        seen.append((list(my_history), list(opp_history), my_history, opp_history))
        my_history.append("tamper")
        opp_history.clear()
        return "AID"

    def opponent(my_history, opp_history):
        return ["WITHHOLD", "AID", "WITHHOLD"][len(my_history)]

    result = play_match(watcher, opponent, PRISONERS_DILEMMA, turns=3)
    assert [entry[:2] for entry in seen] == [
        ([], []),
        (["AID"], ["WITHHOLD"]),
        (["AID", "AID"], ["WITHHOLD", "AID"]),
    ]
    assert len({id(entry[2]) for entry in seen}) == 3
    assert len({id(entry[3]) for entry in seen}) == 3
    assert result["history1"] == ["AID"] * 3
    assert result["history2"] == ["WITHHOLD", "AID", "WITHHOLD"]


def test_clean_guarded_pd_match_is_unchanged():
    plain = play_match(always_cooperate, always_defect, PRISONERS_DILEMMA, 5, seed=3)
    guarded = play_match(
        always_cooperate, always_defect, PRISONERS_DILEMMA, 5, seed=3, guard=True,
    )
    assert guarded == plain


@pytest.mark.parametrize("allocation", [
    [0, 0, 0, 10],
    [4, 3, 2, 1],
    [2, 2, 3, 3],
])
def test_blotto_accepts_valid_allocations(allocation):
    assert BLOTTO.validate_action(allocation) is None


@pytest.mark.parametrize(("allocation", "error"), [
    ((4, 3, 2, 1), "list"),
    ([4, 3, 2], "4 fronts"),
    ([4, 3, 2, 1, 0], "4 fronts"),
    ([4, 3, -1, 4], "cannot be negative"),
    ([4, 3, 2, 2], "sum to 10"),
    ([4, 3, 2, 1.0], "integer troop count"),
    ([True, 3, 2, 4], "integer troop count"),
])
def test_blotto_rejects_invalid_allocations(allocation, error):
    assert error in BLOTTO.validate_action(allocation)


def test_blotto_scoring_counts_won_fronts_and_split_ties():
    assert BLOTTO.score([4, 3, 2, 1], [3, 3, 2, 2]) == (2.0, 2.0)
    assert BLOTTO.score([10, 0, 0, 0], [0, 10, 0, 0]) == (2.0, 2.0)
    with pytest.raises(ValueError, match="must sum to 10"):
        BLOTTO.score([4, 3, 2, 2], [2, 2, 3, 3])


def test_blotto_match_exposes_only_previous_allocations_to_bots():
    seen = []

    def observe(my_history, opp_history):
        seen.append((my_history, opp_history))
        return [4, 3, 2, 1]

    match = play_match(observe, allocation_bot([3, 3, 2, 2]), BLOTTO, turns=2, seed=3)
    assert match["score1"] == match["score2"] == 4.0
    assert seen == [
        ([], []),
        ([[4, 3, 2, 1]], [[3, 3, 2, 2]]),
    ]


def test_blotto_noise_is_rejected_until_a_rule_is_approved():
    with pytest.raises(ValueError, match="noise is not defined"):
        play_match(allocation_bot(EVEN_SPLIT), allocation_bot(EVEN_SPLIT), BLOTTO, 1, noise=0.1)


def test_every_blotto_builtin_returns_valid_allocations_and_has_expected_opening():
    assert set(BLOTTO_BOTS) == {
        "even_split", "all_in", "random_allocation", "copy_opponent_last",
        "counter_opponent_last",
    }
    for strategy in BLOTTO_BOTS.values():
        assert list(inspect.signature(strategy).parameters) == ["my_history", "opp_history"]
        allocation = strategy([], [])
        assert BLOTTO.validate_action(allocation) is None
    assert BLOTTO_BOTS["even_split"]([], []) == [3, 3, 2, 2]
    assert BLOTTO_BOTS["all_in"]([], []) == [10, 0, 0, 0]
    assert BLOTTO_BOTS["copy_opponent_last"]([], []) == [3, 3, 2, 2]
    assert BLOTTO_BOTS["copy_opponent_last"]([], [[1, 2, 3, 4]]) == [1, 2, 3, 4]
    previous = [4, 3, 2, 1]
    counter = BLOTTO_BOTS["counter_opponent_last"]([], [previous])
    assert BLOTTO.validate_action(counter) is None
    assert BLOTTO.score(counter, previous)[0] == max(
        BLOTTO.score(candidate, previous)[0]
        for candidate in (
            [a, b, c, 10 - a - b - c]
            for a in range(11)
            for b in range(11 - a)
            for c in range(11 - a - b)
        )
    )


def test_registry_contains_only_configured_game_bots():
    assert set(bots_for(PRISONERS_DILEMMA)) == set(BUILT_IN_BOTS)
    assert set(bots_for(BLOTTO)) == set(BLOTTO_BOTS)
    assert bots_for(TRUST) == {}
    assert REGISTRY.game_of("even_split") is BLOTTO


def test_registered_games_can_play_and_preserve_forfeit_credit():
    assert play_registered("always_cooperate", "always_defect", turns=5)["score2"] == 25
    with pytest.raises(ValueError):
        play_registered("always_cooperate", "even_split", turns=1)
    assert PRISONERS_DILEMMA.forfeit_credit(5) == 15
    assert BLOTTO.forfeit_credit(5) == 15


def test_pd_builtin_strategies_have_the_supported_signature_and_actions():
    for strategy in BUILT_IN_BOTS.values():
        assert list(inspect.signature(strategy).parameters) == ["my_history", "opp_history"]
        assert strategy([], []) in PRISONERS_DILEMMA.actions


def test_pd_random_builtin_is_repeatable_when_seeded():
    strategy = BUILT_IN_BOTS["random_bot"]
    first = play_match(strategy, strategy, PRISONERS_DILEMMA, 30, seed=11)
    second = play_match(strategy, strategy, PRISONERS_DILEMMA, 30, seed=11)
    assert first == second


def test_invalid_pd_action_forfeits_instead_of_scoring():
    def invalid(my_history, opp_history):
        return [3, 3, 2, 2]

    result = play_match(
        always_cooperate, invalid, PRISONERS_DILEMMA, turns=4, guard=True,
    )
    assert result["forfeit"]["side"] == 1
    assert "Invalid Prisoner's Dilemma move" in result["forfeit"]["reason"]
    assert result["history1"] == result["history2"] == []
    assert (result["score1"], result["score2"]) == (12, 0)


def test_unknown_trust_rules_remain_blocked():
    with pytest.raises(NotImplementedError, match="pending team approval"):
        play_match(always_cooperate, always_defect, TRUST, turns=1)


def test_round_robin_sorts_team_ids_and_ranks_only_by_total():
    result = run_round_robin(
        {9: always_defect, 2: always_cooperate},
        PRISONERS_DILEMMA,
        turns=1,
        repetitions=1,
    )
    assert [row["name"] for row in result["leaderboard"]] == [9, 2]
    assert [row["rank"] for row in result["leaderboard"]] == [1, 2]
