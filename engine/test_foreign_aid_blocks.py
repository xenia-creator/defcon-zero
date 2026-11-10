"""Regression coverage for the frontend's Round 3 starting strategies."""

from itertools import combinations_with_replacement
from pathlib import Path

import pytest

from engine.foreign_aid_strategies import FOREIGN_AID_BOTS
from engine.games import FOREIGN_AID
from engine.match import play_match
from engine.sandbox import load_bot


ENDOWMENT = 10
MULTIPLIER = 3
TURNS = 200
FIXTURE_DIR = Path(__file__).parent / "tests" / "fixtures" / "foreign_aid_blocks"
FIXTURE_NAMES = ("break_even", "mirror", "grudger", "matcher")
FIXTURE_CODES = {
    name: (FIXTURE_DIR / f"{name}.py").read_text(encoding="utf-8")
    for name in FIXTURE_NAMES
}


def _matchups():
    matchups = []
    for first, second in combinations_with_replacement(FIXTURE_NAMES, 2):
        matchups.append((first, second))
        if first != second:
            matchups.append((second, first))
    for fixture_name in FIXTURE_NAMES:
        for builtin_name in FOREIGN_AID_BOTS:
            matchups.extend((
                (fixture_name, builtin_name),
                (builtin_name, fixture_name),
            ))
    return matchups


@pytest.mark.parametrize(("first_name", "second_name"), _matchups())
def test_generated_foreign_aid_bots_follow_engine_role_and_move_contract(
    first_name, second_name,
):
    def get_bot(name, side):
        if name in FIXTURE_CODES:
            return load_bot(FIXTURE_CODES[name], random_seed=100 + side)
        return FOREIGN_AID_BOTS[name]

    calls = [[], []]

    def record_calls(bot, side):
        def strategy(my_history, opp_history):
            if len(opp_history) == len(my_history):
                role = "sending"
            elif len(opp_history) > len(my_history):
                role = "receiving"
            else:
                role = "invalid"
            move = bot(my_history, opp_history)
            calls[side].append((role, len(my_history), len(opp_history), move))
            return move

        return strategy

    result = play_match(
        record_calls(get_bot(first_name, 0), 0),
        record_calls(get_bot(second_name, 1), 1),
        FOREIGN_AID,
        TURNS,
        seed=2036,
        guard=True,
    )

    assert result["forfeit"] is None
    assert len(result["history1"]) == len(result["history2"]) == TURNS

    for side, side_calls in enumerate(calls):
        assert len(side_calls) == TURNS
        for turn, (role, my_length, opp_length, move) in enumerate(side_calls):
            assert role == ("sending" if turn % 2 == side else "receiving")
            if role == "sending":
                assert opp_length == my_length
                assert type(move) is int
                assert 0 <= move <= ENDOWMENT
            else:
                assert opp_length > my_length
                assert type(move) is int
                assert 0 <= move <= MULTIPLIER * result[
                    "history2" if side == 0 else "history1"
                ][turn]

    histories = (result["history1"], result["history2"])
    for turn in range(TURNS):
        sender = turn % 2
        sent = histories[sender][turn]
        returned = histories[1 - sender][turn]
        assert FOREIGN_AID.validate_action(sent, role="sender") is None
        assert FOREIGN_AID.validate_action(
            returned, role="receiver", sent=sent,
        ) is None
        assert type(sent) is int
        assert 0 <= sent <= ENDOWMENT
        assert type(returned) is int
        assert 0 <= returned <= MULTIPLIER * sent
