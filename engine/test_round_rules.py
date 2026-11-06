import inspect

import pytest

from engine.blotto_strategies import BLOTTO_BOTS
from engine.foreign_aid_strategies import FOREIGN_AID_BOTS, tit_for_tat
from engine.games import (
    FOREIGN_AID,
    GAMES,
    PRISONERS_DILEMMA,
    THEATRE_OF_WAR,
)
from engine.match import play_match
from engine.registry import bots_for, play_registered
from engine.strategies import BUILT_IN_BOTS


def test_game_catalog_uses_the_current_three_keys():
    assert tuple(GAMES) == (
        "prisoners_dilemma", "theatre_of_war", "foreign_aid",
    )


def test_prisoners_dilemma_preserves_payoffs_with_c_and_d_actions():
    assert PRISONERS_DILEMMA.actions == ("C", "D")
    assert PRISONERS_DILEMMA.payoffs == {
        ("C", "C"): (3, 3),
        ("C", "D"): (0, 5),
        ("D", "C"): (5, 0),
        ("D", "D"): (1, 1),
    }
    assert PRISONERS_DILEMMA.score("C", "D") == (0, 5)
    with pytest.raises(ValueError, match="Invalid Prisoner's Dilemma move"):
        PRISONERS_DILEMMA.score("AID", "D")


def test_all_ten_prisoners_dilemma_builtins_use_c_and_d():
    assert len(BUILT_IN_BOTS) == 10
    for strategy in BUILT_IN_BOTS.values():
        assert list(inspect.signature(strategy).parameters) == [
            "my_history", "opp_history",
        ]
        assert strategy([], []) in {"C", "D"}
    assert bots_for(PRISONERS_DILEMMA) == BUILT_IN_BOTS
    result = play_registered("tit_for_tat", "always_cooperate", turns=3)
    assert result["forfeit"] is None


@pytest.mark.parametrize("allocation", [
    [20, 20, 20, 20, 20],
    [100, 0, 0, 0, 0],
    [0, 0, 0, 0, 100],
    [25, 25, 25, 15, 10],
])
def test_theatre_of_war_accepts_valid_allocations(allocation):
    assert THEATRE_OF_WAR.validate_action(allocation) is None


@pytest.mark.parametrize(("allocation", "message"), [
    (None, "list"),
    ((20, 20, 20, 20, 20), "list"),
    ([20, 20, 20, 20], "5 regions"),
    ([20, 20, 20, 20, 20, 0], "5 regions"),
    ([20, 20, 20, 20, 20.0], "whole-number"),
    ([20, 20, 20, 20, True], "whole-number"),
    ([20, 20, 20, 20, -1], "negative"),
    ([20, 20, 20, 20, 19], "sum to 100"),
])
def test_theatre_of_war_rejects_malformed_allocations(allocation, message):
    assert message in THEATRE_OF_WAR.validate_action(allocation)


def test_theatre_of_war_awards_one_point_to_turn_winner_and_half_on_tie():
    assert THEATRE_OF_WAR.score(
        [25, 25, 25, 15, 10],
        [20, 20, 20, 20, 20],
    ) == (1, 0)
    assert THEATRE_OF_WAR.score(
        [20, 20, 20, 20, 20],
        [20, 20, 20, 20, 20],
    ) == (0.5, 0.5)
    assert THEATRE_OF_WAR.score(
        [50, 20, 10, 10, 10],
        [20, 20, 20, 20, 20],
    ) == (0, 1)


def test_theatre_of_war_invalid_action_forfeits_before_scoring():
    valid = lambda my_history, opp_history: [20, 20, 20, 20, 20]
    invalid = lambda my_history, opp_history: [20, 20, 20, 20, 19]
    result = play_match(valid, invalid, THEATRE_OF_WAR, 3, guard=True)
    assert result["forfeit"]["side"] == 1
    assert result["history1"] == result["history2"] == []
    assert (result["score1"], result["score2"]) == (9, 0)


def test_all_theatre_of_war_builtins_are_valid_and_registered():
    assert set(BLOTTO_BOTS) == {
        "even_split", "all_in", "random", "copy_opponent_last",
        "counter_opponent_last",
    }
    assert set(bots_for(THEATRE_OF_WAR)) == set(BLOTTO_BOTS)
    registered_random = play_registered(
        "random", "random", turns=2, seed=7, game=THEATRE_OF_WAR,
    )
    assert registered_random["forfeit"] is None
    assert BLOTTO_BOTS["even_split"]([], []) == [20] * 5
    assert BLOTTO_BOTS["all_in"]([], []) == [100, 0, 0, 0, 0]
    assert BLOTTO_BOTS["copy_opponent_last"]([], []) == [20] * 5
    previous = [40, 30, 20, 10, 0]
    copied = BLOTTO_BOTS["copy_opponent_last"]([], [previous])
    assert copied == previous and copied is not previous


def test_theatre_random_and_counter_bots_always_return_valid_lists():
    random_result = play_match(
        BLOTTO_BOTS["random"], BLOTTO_BOTS["random"],
        THEATRE_OF_WAR, 8, seed=41,
    )
    repeat = play_match(
        BLOTTO_BOTS["random"], BLOTTO_BOTS["random"],
        THEATRE_OF_WAR, 8, seed=41,
    )
    assert random_result == repeat
    assert random_result["forfeit"] is None
    assert all(THEATRE_OF_WAR.validate_action(move) is None
               for move in random_result["history1"] + random_result["history2"])

    allocations = [
        [100, 0, 0, 0, 0],
        [40, 30, 20, 10, 0],
        [20, 20, 20, 20, 20],
        [50, 20, 10, 10, 10],
    ]
    for previous in allocations:
        counter = BLOTTO_BOTS["counter_opponent_last"]([], [previous])
        weakest = sorted(range(5), key=lambda index: (previous[index], index))[:3]
        assert all(counter[index] == previous[index] + 1 for index in weakest)
        assert THEATRE_OF_WAR.validate_action(counter) is None
    assert BLOTTO_BOTS["counter_opponent_last"]([], []) == [20] * 5


def test_foreign_aid_action_validation_boundaries_and_types():
    for amount in (0, 10):
        assert FOREIGN_AID.validate_action(amount, role="sender") is None
    for amount in (-1, 11, 1.0, True, None, "10"):
        assert FOREIGN_AID.validate_action(amount, role="sender") is not None
    for returned, sent in ((0, 0), (30, 10), (7, 3)):
        assert FOREIGN_AID.validate_action(
            returned, role="receiver", sent=sent,
        ) is None
    for returned, sent in (
        (-1, 10), (31, 10), (1.0, 1), (True, 1), (None, 0), ("0", 0),
    ):
        assert FOREIGN_AID.validate_action(
            returned, role="receiver", sent=sent,
        ) is not None


def test_foreign_aid_score_uses_exact_payoff_formulas():
    assert FOREIGN_AID.score(0, 0) == (10, 0)
    assert FOREIGN_AID.score(10, 0) == (0, 30)
    assert FOREIGN_AID.score(10, 30) == (30, 0)
    assert FOREIGN_AID.score(4, 6) == (12, 6)


def test_foreign_aid_roles_alternate_and_receiver_sees_current_send():
    calls = []

    def first(my_history, opp_history):
        calls.append(("first", list(my_history), list(opp_history)))
        return 10 if len(my_history) == len(opp_history) else 0

    def second(my_history, opp_history):
        calls.append(("second", list(my_history), list(opp_history)))
        return 0 if len(my_history) == len(opp_history) else 15

    result = play_match(first, second, FOREIGN_AID, 4, guard=True)
    assert [entry[0] for entry in calls] == [
        "first", "second", "second", "first",
        "first", "second", "second", "first",
    ]
    assert calls[1] == ("second", [], [10])
    assert calls[3] == ("first", [10], [15, 0])
    assert calls[5] == ("second", [15, 0], [10, 0, 10])
    assert result["history1"] == [10, 0, 10, 0]
    assert result["history2"] == [15, 0, 15, 0]
    assert (result["score1"], result["score2"]) == (30, 50)
    assert result["forfeit"] is None


def test_foreign_aid_invalid_sender_and_receiver_actions_forfeit():
    valid_zero = lambda my_history, opp_history: 0
    invalid_sender = lambda my_history, opp_history: 11
    sender_forfeit = play_match(
        invalid_sender, valid_zero, FOREIGN_AID, 2, guard=True,
    )
    assert sender_forfeit["forfeit"]["side"] == 0
    assert (sender_forfeit["score1"], sender_forfeit["score2"]) == (0, 6)

    invalid_receiver = lambda my_history, opp_history: 1
    receiver_forfeit = play_match(
        lambda my_history, opp_history: 0,
        invalid_receiver,
        FOREIGN_AID,
        2,
        guard=True,
    )
    assert receiver_forfeit["forfeit"]["side"] == 1
    assert (receiver_forfeit["score1"], receiver_forfeit["score2"]) == (6, 0)


def test_all_foreign_aid_builtins_and_role_aware_tit_for_tat():
    assert set(FOREIGN_AID_BOTS) == {
        "always_send_10_return_half", "always_send_0_return_0",
        "tit_for_tat", "random",
    }
    assert set(bots_for(FOREIGN_AID)) == set(FOREIGN_AID_BOTS)
    assert tit_for_tat([], []) == 0
    assert tit_for_tat([4], [8]) == 8
    assert tit_for_tat([4], [3, 8]) == 0
    assert tit_for_tat([10, 7, 9], [0, 10, 5, 4]) == 7
    assert tit_for_tat([4], [99]) == 10
    assert tit_for_tat([10, 7, 9], [0, 10, 5, 0]) == 0

    for strategies in (
        (FOREIGN_AID_BOTS["always_send_10_return_half"],) * 2,
        (FOREIGN_AID_BOTS["always_send_0_return_0"],) * 2,
        (FOREIGN_AID_BOTS["tit_for_tat"],) * 2,
        (FOREIGN_AID_BOTS["random"],) * 2,
    ):
        result = play_match(*strategies, FOREIGN_AID, 8, seed=19, guard=True)
        repeat = play_match(*strategies, FOREIGN_AID, 8, seed=19, guard=True)
        assert result == repeat
        assert result["forfeit"] is None
        assert len(result["history1"]) == len(result["history2"]) == 8
        for side, history in enumerate((result["history1"], result["history2"])):
            opponent_history = result["history2"] if side == 0 else result["history1"]
            for index, action in enumerate(history):
                is_sender = index % 2 == side
                assert FOREIGN_AID.validate_action(
                    action,
                    role="sender" if is_sender else "receiver",
                    sent=None if is_sender else opponent_history[index],
                ) is None
