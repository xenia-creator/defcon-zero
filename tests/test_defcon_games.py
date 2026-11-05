"""Rounds 1–3: payoffs, noise, resources, histories, forfeits and every bot."""

import inspect
import random

import pytest

from engine.aid_strategies import (
    adaptive_aid,
    always_aid,
    grudger_aid,
    majority_aid,
    never_aid,
    reciprocity,
    tit_for_tat_aid,
)
from engine.games import (
    CHICKEN,
    FOREIGN_AID,
    PRISONERS_DILEMMA,
    STAG_HUNT,
    THEATRE_OF_WAR,
)
from engine.match import play_match
from engine.noise import apply_noise
from engine.registry import (
    REGISTRY,
    bots_for,
    get_bot,
    play_registered,
    register_bot,
)
from engine.strategies import (
    BUILT_IN_BOTS,
    always_cooperate,
    always_defect,
    tit_for_tat,
)
from engine.timeout import unresponsive_cooperate
from engine.tournament import run_round_robin
from engine.war_strategies import (
    WAR_BOTS,
    aggressive,
    balanced,
    defensive,
    expansionist,
    fortress,
    opportunistic,
)
from engine.aid_strategies import AID_BOTS


class _Rng:
    """Scripted stand-in for random.Random. `choice` receives the alternatives."""

    def __init__(self, rolls, picks=()):
        self.rolls = list(rolls)
        self.picks = list(picks)

    def random(self):
        return self.rolls.pop(0)

    def choice(self, seq):
        return seq[self.picks.pop(0)]


def _script(moves):
    def strategy(my_history, opp_history):
        return moves[len(my_history)]
    return strategy


# --- Payoffs -----------------------------------------------------------------

@pytest.mark.parametrize("game, cells", [
    (PRISONERS_DILEMMA, {
        ("C", "C"): (3, 3), ("C", "D"): (0, 5),
        ("D", "C"): (5, 0), ("D", "D"): (1, 1),
    }),
    (CHICKEN, {
        ("C", "C"): (3, 3), ("C", "D"): (1, 5),
        ("D", "C"): (5, 1), ("D", "D"): (0, 0),
    }),
    (STAG_HUNT, {
        ("C", "C"): (4, 4), ("C", "D"): (0, 3),
        ("D", "C"): (3, 0), ("D", "D"): (2, 2),
    }),
    (THEATRE_OF_WAR, {
        ("ATTACK", "ATTACK"): (1, 1), ("ATTACK", "DEFEND"): (0, 2),
        ("ATTACK", "EXPAND"): (5, 0), ("DEFEND", "ATTACK"): (2, 0),
        ("DEFEND", "DEFEND"): (2, 2), ("DEFEND", "EXPAND"): (1, 4),
        ("EXPAND", "ATTACK"): (0, 5), ("EXPAND", "DEFEND"): (4, 1),
        ("EXPAND", "EXPAND"): (3, 3),
    }),
    (FOREIGN_AID, {
        ("AID", "AID"): (2, 2), ("AID", "WITHHOLD"): (-1, 3),
        ("WITHHOLD", "AID"): (3, -1), ("WITHHOLD", "WITHHOLD"): (0, 0),
    }),
])
def test_payoff_matrix(game, cells):
    assert game.payoffs == cells
    for moves, scores in cells.items():
        assert game.score(*moves) == scores


def test_legacy_chicken_and_stag_hunt_still_score_a_match():
    chicken = play_match(always_cooperate, always_defect, CHICKEN, turns=10)
    assert (chicken["score1"], chicken["score2"]) == (10, 50)
    stag = play_match(always_cooperate, always_defect, STAG_HUNT, turns=10)
    assert (stag["score1"], stag["score2"]) == (0, 30)


# --- Rules examples ----------------------------------------------------------

def test_rules_example_tit_for_tat_vs_always_defect():
    result = play_match(tit_for_tat, always_defect, PRISONERS_DILEMMA, turns=5)
    assert result["history1"] == ["C", "D", "D", "D", "D"]
    assert result["history2"] == ["D", "D", "D", "D", "D"]
    assert (result["score1"], result["score2"]) == (4, 9)
    assert result["forfeit"] is None


def test_rules_example_aggressive_vs_defensive():
    result = play_match(aggressive, defensive, THEATRE_OF_WAR, turns=5)
    assert result["history1"] == ["ATTACK"] * 5
    assert result["history2"] == ["DEFEND"] * 5
    assert (result["score1"], result["score2"]) == (0, 10)


def test_rules_example_fortress_vs_aggressive():
    result = play_match(fortress, aggressive, THEATRE_OF_WAR, turns=6)
    assert result["history1"] == ["DEFEND", "DEFEND", "DEFEND", "ATTACK", "ATTACK", "ATTACK"]
    assert result["history2"] == ["ATTACK"] * 6
    assert (result["score1"], result["score2"]) == (9, 3)


def test_rules_example_expansionist_vs_opportunistic():
    result = play_match(expansionist, opportunistic, THEATRE_OF_WAR, turns=6)
    assert result["history1"] == ["EXPAND", "EXPAND", "ATTACK", "ATTACK", "EXPAND", "EXPAND"]
    assert result["history2"] == ["EXPAND", "ATTACK", "ATTACK", "DEFEND", "DEFEND", "ATTACK"]
    assert (result["score1"], result["score2"]) == (8, 17)


def test_rules_example_tit_for_tat_aid_vs_never_aid():
    result = play_match(tit_for_tat_aid, never_aid, FOREIGN_AID, turns=6)
    assert result["history1"] == ["AID"] + ["WITHHOLD"] * 5
    assert result["history2"] == ["WITHHOLD"] * 6
    assert (result["score1"], result["score2"]) == (9, 13)


def test_rules_example_always_aid_vs_never_aid():
    result = play_match(always_aid, never_aid, FOREIGN_AID, turns=14)
    assert result["history1"] == ["AID"] * 10 + ["WITHHOLD"] * 4
    assert result["history2"] == ["WITHHOLD"] * 14
    assert (result["score1"], result["score2"]) == (0, 40)


def test_rules_example_mutual_aid():
    result = play_match(always_aid, always_aid, FOREIGN_AID, turns=200)
    assert result["history1"] == ["AID"] * 200
    assert (result["score1"], result["score2"]) == (410, 410)
    assert isinstance(result["score1"], int)


def test_foreign_aid_match_score_includes_starting_resources():
    result = play_match(always_aid, always_aid, FOREIGN_AID, turns=1)
    assert (result["score1"], result["score2"]) == (12, 12)


# --- Foreign Aid resources ---------------------------------------------------

@pytest.mark.parametrize("moves, resources", [
    (("AID", "AID"), [12, 12]),
    (("AID", "WITHHOLD"), [9, 13]),
    (("WITHHOLD", "AID"), [13, 9]),
    (("WITHHOLD", "WITHHOLD"), [10, 10]),
])
def test_foreign_aid_formula_from_the_start(moves, resources):
    state = FOREIGN_AID.new_state()
    played = FOREIGN_AID.resolve_actions(state, *moves)
    assert played == moves
    FOREIGN_AID.apply(state, *played)
    assert state["resources"] == resources


def test_resource_floor_and_unaffordable_aid():
    broke = FOREIGN_AID.new_state()
    broke["resources"] = [0, 0]
    assert FOREIGN_AID.resolve_actions(broke, "AID", "AID") == ("WITHHOLD", "WITHHOLD")
    FOREIGN_AID.apply(broke, "AID", "WITHHOLD")
    assert broke["resources"] == [0, 3]

    one_each = {"resources": [1, 1], "score1": 1, "score2": 1}
    assert FOREIGN_AID.resolve_actions(one_each, "AID", "AID") == ("AID", "AID")


def test_affordability_uses_resources_from_the_start_of_the_turn():
    """The broke player cannot spend aid that arrives in the same turn."""
    giver = _script(["AID"] * 11)
    receiver = _script(["WITHHOLD"] * 10 + ["AID"])
    result = play_match(giver, receiver, FOREIGN_AID, turns=11)
    assert result["history1"][-1] == "WITHHOLD"
    assert result["history2"][-1] == "AID"
    assert (result["score1"], result["score2"]) == (3, 39)


# --- Noise -------------------------------------------------------------------

def test_noise_rules_do_not_draw_when_noise_is_zero():
    class Boom:
        def random(self):
            raise AssertionError("noise drew from the rng")

    assert apply_noise("C", PRISONERS_DILEMMA.actions, 0, Boom()) == "C"


def test_noise_replaces_a_move_according_to_the_round():
    actions2 = THEATRE_OF_WAR.actions
    assert apply_noise("C", ("C", "D"), 1, _Rng([0.0])) == "D"
    assert apply_noise("D", ("C", "D"), 1, _Rng([0.0])) == "C"
    assert apply_noise("X", ("C", "D"), 1, _Rng([0.0])) == "C"
    assert apply_noise("ATTACK", actions2, 0.5, _Rng([0.9])) == "ATTACK"
    assert apply_noise("ATTACK", actions2, 0.5, _Rng([0.2], [1])) == "EXPAND"
    assert apply_noise("DEFEND", actions2, 1, _Rng([0.0], [0])) == "ATTACK"
    assert apply_noise("EXPAND", actions2, 1, _Rng([0.0], [1])) == "DEFEND"
    assert apply_noise("AID", FOREIGN_AID.actions, 1, _Rng([0.0])) == "WITHHOLD"
    assert apply_noise("WITHHOLD", FOREIGN_AID.actions, 1, _Rng([0.0])) == "AID"


def test_prisoners_dilemma_noise_flips_every_move():
    result = play_match(always_cooperate, always_defect, PRISONERS_DILEMMA, turns=5, noise=1)
    assert result["history1"] == ["D"] * 5
    assert result["history2"] == ["C"] * 5
    assert (result["score1"], result["score2"]) == (25, 0)


def test_war_noise_picks_one_of_the_other_actions_and_repeats_with_the_seed():
    first = play_match(aggressive, defensive, THEATRE_OF_WAR, turns=40, noise=1, seed=5)
    second = play_match(aggressive, defensive, THEATRE_OF_WAR, turns=40, noise=1, seed=5)
    assert first == second
    assert set(first["history1"]) == {"DEFEND", "EXPAND"}
    assert set(first["history2"]) == {"ATTACK", "EXPAND"}


def test_foreign_aid_noise_swaps_aid_and_withhold():
    result = play_match(always_aid, never_aid, FOREIGN_AID, turns=5, noise=1)
    assert result["history1"] == ["WITHHOLD"] * 5
    assert result["history2"] == ["AID"] * 5
    assert (result["score1"], result["score2"]) == (25, 5)


def test_same_seed_repeats_random_bots_and_partial_noise():
    for game, bot in (
        (PRISONERS_DILEMMA, get_bot("random_bot")),
        (THEATRE_OF_WAR, get_bot("random_war")),
        (FOREIGN_AID, get_bot("random_aid")),
    ):
        quiet = [
            play_match(bot, bot, game, turns=30, seed=11),
            play_match(bot, bot, game, turns=30, seed=11),
        ]
        noisy = [
            play_match(bot, bot, game, turns=30, noise=0.3, seed=11),
            play_match(bot, bot, game, turns=30, noise=0.3, seed=11),
        ]
        assert quiet[0] == quiet[1]
        assert noisy[0] == noisy[1]
        assert noisy[0]["history1"] != quiet[0]["history1"]


def test_guard_does_not_change_a_clean_match():
    plain = play_match(get_bot("random_bot"), tit_for_tat, PRISONERS_DILEMMA, turns=40, noise=0.2, seed=42)
    guarded = play_match(
        get_bot("random_bot"), tit_for_tat, PRISONERS_DILEMMA,
        turns=40, noise=0.2, seed=42, guard=True,
    )
    assert plain == guarded


# --- Histories ---------------------------------------------------------------

def test_histories_are_oldest_first_copies_of_the_scored_moves():
    seen = []

    def watcher(my_history, opp_history):
        seen.append((list(my_history), list(opp_history), id(my_history), id(opp_history)))
        my_history.append("NO")
        opp_history.clear()
        return "C"

    result = play_match(watcher, _script(["D", "C", "D"]), PRISONERS_DILEMMA, turns=3)
    assert [pair[:2] for pair in seen] == [
        ([], []),
        (["C"], ["D"]),
        (["C", "C"], ["D", "C"]),
    ]
    assert len({pair[2] for pair in seen}) == 3
    assert len({pair[3] for pair in seen}) == 3
    assert result["history1"] == ["C", "C", "C"]
    assert result["history2"] == ["D", "C", "D"]


def test_histories_record_moves_after_noise():
    seen = []

    def watcher(my_history, opp_history):
        seen.append(list(opp_history))
        return "DEFEND"

    result = play_match(aggressive, watcher, THEATRE_OF_WAR, turns=4, noise=1, seed=3)
    assert "ATTACK" not in result["history1"]
    assert seen[0] == []
    assert seen[1:] == [[move] if i == 0 else result["history1"][: i + 1]
                        for i, move in enumerate(result["history1"][:-1])]
    assert all(len(my) == len(opp) for my, opp in zip(seen, seen))


def test_opponent_sees_the_flipped_move_on_the_next_turn():
    seen = []

    def watcher(my_history, opp_history):
        seen.append((list(my_history), list(opp_history)))
        return "C"

    result = play_match(watcher, always_cooperate, PRISONERS_DILEMMA, turns=3, noise=1)
    assert result["history1"] == ["D", "D", "D"]
    assert result["history2"] == ["D", "D", "D"]
    assert seen == [([], []), (["D"], ["D"]), (["D", "D"], ["D", "D"])]


def test_balanced_follows_the_turn_number_when_noise_changes_its_history():
    chosen = []

    def wrapped(my_history, opp_history):
        move = balanced(my_history, opp_history)
        chosen.append(move)
        return move

    result = play_match(wrapped, defensive, THEATRE_OF_WAR, turns=6, noise=1, seed=1)
    assert chosen == ["ATTACK", "DEFEND", "EXPAND", "ATTACK", "DEFEND", "EXPAND"]
    assert all(played != intended for played, intended in zip(result["history1"], chosen))


def test_history_bots_react_to_the_move_noise_actually_played():
    chosen = []

    def wrapped(my_history, opp_history):
        move = fortress(my_history, opp_history)
        chosen.append((move, list(opp_history)))
        return move

    result = play_match(wrapped, aggressive, THEATRE_OF_WAR, turns=6, noise=1, seed=2)
    assert all(move == "DEFEND" for move, _ in chosen)
    assert all("ATTACK" not in opp for _, opp in chosen)
    assert [opp for _, opp in chosen] == [[] ] + [result["history2"][:i] for i in range(1, 6)]


# --- Bots --------------------------------------------------------------------

def test_round1_registry_matches_the_sandbox_builtins():
    assert set(BUILT_IN_BOTS) == {
        "always_cooperate", "always_defect", "random_bot", "tit_for_tat",
        "grudger", "tit_for_two_tats", "alternator", "suspicious_tit_for_tat",
        "win_stay_lose_shift",
    }
    assert set(WAR_BOTS).isdisjoint(BUILT_IN_BOTS)
    assert set(AID_BOTS).isdisjoint(BUILT_IN_BOTS)
    assert bots_for(PRISONERS_DILEMMA).keys() == BUILT_IN_BOTS.keys()


def test_every_bot_uses_the_two_history_signature_and_legal_actions():
    openings = {
        "always_cooperate": "C", "always_defect": "D", "tit_for_tat": "C",
        "grudger": "C", "tit_for_two_tats": "C", "alternator": "C",
        "suspicious_tit_for_tat": "D", "win_stay_lose_shift": "C",
        "aggressive": "ATTACK", "defensive": "DEFEND", "expansionist": "EXPAND",
        "fortress": "DEFEND", "balanced": "ATTACK", "opportunistic": "EXPAND",
        "always_aid": "AID", "never_aid": "WITHHOLD", "tit_for_tat_aid": "AID",
        "reciprocity": "AID", "grudger_aid": "AID", "majority_aid": "AID",
        "adaptive_aid": "AID",
    }
    seen = set()
    for game in (PRISONERS_DILEMMA, THEATRE_OF_WAR, FOREIGN_AID):
        bots = bots_for(game)
        assert bots
        for index, (name, strategy) in enumerate(bots.items()):
            assert name not in seen
            seen.add(name)
            assert list(inspect.signature(strategy).parameters) == ["my_history", "opp_history"]
            assert REGISTRY.game_of(name).key == game.key
            assert get_bot(name) is strategy
            if name in openings:
                assert strategy([], []) == openings[name]
            else:
                assert strategy([], []) in game.actions
            result = play_match(strategy, strategy, game, turns=6, seed=1000 + index)
            assert len(result["history1"]) == len(result["history2"]) == 6
            assert set(result["history1"]) <= set(game.actions)
            assert set(result["history2"]) <= set(game.actions)
    assert seen == set(openings) | {"random_bot", "random_war", "random_aid"}


def test_war_bots_follow_their_definitions():
    assert expansionist([], ["DEFEND"]) == "EXPAND"
    assert expansionist([], ["EXPAND"]) == "EXPAND"
    assert expansionist([], ["ATTACK"]) == "ATTACK"
    assert fortress([], ["ATTACK", "ATTACK"]) == "DEFEND"
    assert fortress([], ["ATTACK", "ATTACK", "ATTACK"]) == "ATTACK"
    assert fortress([], ["ATTACK", "ATTACK", "ATTACK", "DEFEND"]) == "DEFEND"
    assert [balanced(["ATTACK"] * n, []) for n in range(6)] == [
        "ATTACK", "DEFEND", "EXPAND", "ATTACK", "DEFEND", "EXPAND",
    ]
    assert opportunistic([], ["EXPAND"]) == "ATTACK"
    assert opportunistic([], ["DEFEND"]) == "EXPAND"
    assert opportunistic([], ["ATTACK"]) == "DEFEND"


def test_aid_bots_follow_their_definitions():
    assert tit_for_tat_aid([], ["WITHHOLD"]) == "WITHHOLD"
    assert grudger_aid([], ["AID", "AID"]) == "AID"
    assert grudger_aid([], ["AID", "WITHHOLD", "AID"]) == "WITHHOLD"
    assert majority_aid([], ["AID", "WITHHOLD"]) == "AID"
    assert majority_aid([], ["WITHHOLD", "WITHHOLD", "AID"]) == "WITHHOLD"
    assert adaptive_aid([], []) == "AID"
    assert adaptive_aid([], ["AID", "WITHHOLD"]) == "AID"
    assert adaptive_aid([], ["WITHHOLD", "WITHHOLD"]) == "WITHHOLD"
    assert adaptive_aid([], ["WITHHOLD", "WITHHOLD", "AID", "AID", "AID"]) == "AID"
    assert adaptive_aid([], ["AID", "AID", "WITHHOLD", "WITHHOLD", "WITHHOLD"]) == "WITHHOLD"
    older = ["AID"] * 5 + ["WITHHOLD"] * 5
    assert adaptive_aid([], older) == "WITHHOLD"

    def sample(seed):
        random.seed(seed)
        history = ["AID", "WITHHOLD"]
        return [reciprocity(history, history) for _ in range(20)]

    assert sample(1) == sample(1)
    assert set(sample(1)) == {"AID", "WITHHOLD"}


def test_random_aid_and_random_war_are_repeatable():
    def draw(bot, seed):
        random.seed(seed)
        return [bot([], []) for _ in range(30)]

    assert draw(get_bot("random_war"), 4) == draw(get_bot("random_war"), 4)
    assert draw(get_bot("random_aid"), 4) == draw(get_bot("random_aid"), 4)
    assert set(draw(get_bot("random_war"), 4)) == {"ATTACK", "DEFEND", "EXPAND"}
    assert set(draw(get_bot("random_aid"), 4)) == {"AID", "WITHHOLD"}


def test_registered_match_and_round_robin():
    assert play_registered("aggressive", "defensive", turns=5)["score2"] == 10
    with pytest.raises(ValueError):
        play_registered("aggressive", "always_aid", turns=1)
    for game in (THEATRE_OF_WAR, FOREIGN_AID):
        bots = bots_for(game)
        first = run_round_robin(bots, game, turns=8, repetitions=1, seed=9)
        second = run_round_robin(bots, game, turns=8, repetitions=1, seed=9)
        assert [row["name"] for row in first["leaderboard"]] == list(bots)
        assert first == second


def test_custom_bot_registration():
    def my_custom_bot(my_history, opp_history):
        if not opp_history:
            return "C"
        return opp_history[-1]

    register_bot("my_custom_bot", my_custom_bot, PRISONERS_DILEMMA)
    try:
        result = play_registered("my_custom_bot", "always_defect", turns=5)
        assert (result["score1"], result["score2"]) == (4, 9)
        with pytest.raises(ValueError):
            register_bot("my_custom_bot", my_custom_bot, PRISONERS_DILEMMA)
    finally:
        REGISTRY._bots.pop("my_custom_bot", None)


# --- Forfeits ----------------------------------------------------------------

def test_forfeit_credits():
    assert PRISONERS_DILEMMA.forfeit_credit(5) == 15
    assert THEATRE_OF_WAR.forfeit_credit(200) == 600
    assert FOREIGN_AID.forfeit_credit(6) == 22
    assert FOREIGN_AID.forfeit_credit(200) == 410


def test_invalid_action_and_exception_forfeit_the_match():
    def bad(my_history, opp_history):
        return "ATTACK"

    def boom(my_history, opp_history):
        if my_history:
            raise RuntimeError("boom")
        return "AID"

    invalid = play_match(always_cooperate, bad, PRISONERS_DILEMMA, turns=4, guard=True)
    assert (invalid["score1"], invalid["score2"]) == (12, 0)
    assert invalid["forfeit"]["side"] == 1
    assert "ATTACK" in invalid["forfeit"]["reason"]
    assert invalid["history1"] == []

    crashed = play_match(boom, never_aid, FOREIGN_AID, turns=6, guard=True)
    assert crashed["history1"] == ["AID"]
    assert crashed["history2"] == ["WITHHOLD"]
    assert (crashed["score1"], crashed["score2"]) == (0, 22)
    assert crashed["forfeit"]["reason"] == "raised RuntimeError: boom"

    war = play_match(bad, aggressive, THEATRE_OF_WAR, turns=5, guard=True)
    assert war["forfeit"]["side"] == 0
    assert (war["score1"], war["score2"]) == (0, 15)


def test_unguarded_match_still_raises_for_the_sandbox():
    def bad(my_history, opp_history):
        return "NOPE"

    def boom(my_history, opp_history):
        raise RuntimeError("boom")

    with pytest.raises(KeyError):
        play_match(bad, always_cooperate, PRISONERS_DILEMMA, turns=1)
    with pytest.raises(RuntimeError):
        play_match(boom, always_cooperate, PRISONERS_DILEMMA, turns=1)


def test_timeout_forfeits():
    result = play_match(
        unresponsive_cooperate, always_cooperate, PRISONERS_DILEMMA,
        turns=4, timeout=2,
    )
    assert result["history1"] == []
    assert result["history2"] == []
    assert (result["score1"], result["score2"]) == (0, 12)
    assert result["forfeit"]["side"] == 0
    assert result["forfeit"]["reason"] == "timed out after 2s"
