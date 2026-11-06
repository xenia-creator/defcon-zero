"""Individual match results returned by run_safe_round_robin()."""

import json
import unittest

from engine import sandbox
from engine.games import PRISONERS_DILEMMA as PD
from engine.tournament import match_seed

COOP = "def strategy(my_history, opp_history):\n    return 'AID'\n"
DEFECT = "def strategy(my_history, opp_history):\n    return 'WITHHOLD'\n"
TFT = "def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else 'AID'\n"
RANDOM = ("import random\n"
          "def strategy(my_history, opp_history):\n"
          "    return 'AID' if random.random() < 0.5 else 'WITHHOLD'\n")
BAD_MOVE = "def strategy(my_history, opp_history):\n    return 'X'\n"
CRASH = "def strategy(my_history, opp_history):\n    return 1 // 0\n"
LOOP = "def strategy(my_history, opp_history):\n    while True:\n        pass\n"

MATCH_FIELDS = {
    "player_a", "player_b", "repetition", "seed", "status", "score_a", "score_b",
    "result", "winner", "forfeit_side", "forfeit_reason", "self_play", "counted",
}


def totals_from_matches(matches):
    """Recompute every bot's total from the match records alone."""
    totals = {}
    for m in matches:
        if not m["counted"]:
            continue
        totals[m["player_a"]] = totals.get(m["player_a"], 0) + m["score_a"]
        if not m["self_play"]:
            totals[m["player_b"]] = totals.get(m["player_b"], 0) + m["score_b"]
    return totals


def run(bots, turns=10, repetitions=1, noise=0.0, seed=1, **kwargs):
    return sandbox.run_safe_round_robin(bots, PD, turns, repetitions, noise, seed, **kwargs)


class MatchCountTests(unittest.TestCase):
    def test_two_player_tournament_returns_one_match(self):
        r = run({1: COOP, 2: DEFECT}, include_self_play=False)
        self.assertEqual(len(r["matches"]), 1)
        m = r["matches"][0]
        self.assertEqual((m["player_a"], m["player_b"]), (1, 2))
        self.assertEqual((m["score_a"], m["score_b"]), (0, 50))

    def test_three_player_tournament_returns_three_matches(self):
        r = run({1: COOP, 2: DEFECT, 3: TFT}, include_self_play=False)
        self.assertEqual(len(r["matches"]), 3)
        self.assertEqual({(m["player_a"], m["player_b"]) for m in r["matches"]},
                         {(1, 2), (1, 3), (2, 3)})

    def test_default_keeps_existing_self_play(self):
        r = run({1: COOP, 2: DEFECT})
        self.assertEqual(len(r["matches"]), 3)           # 2 self-play + 1 pairing
        self.assertEqual(sum(m["self_play"] for m in r["matches"]), 2)

    def test_repetitions_multiply_matches(self):
        r = run({1: COOP, 2: DEFECT, 3: TFT}, repetitions=3, include_self_play=False)
        self.assertEqual(len(r["matches"]), 9)
        self.assertEqual(sorted({m["repetition"] for m in r["matches"]}), [0, 1, 2])


class AggregateTests(unittest.TestCase):
    def test_individual_scores_add_up_to_totals(self):
        bots = {"coop": COOP, "defect": DEFECT, "tft": TFT, "rnd": RANDOM}
        for self_play in (True, False):
            r = run(bots, turns=40, repetitions=2, noise=0.05, seed=7, include_self_play=self_play)
            expected = totals_from_matches(r["matches"])
            self.assertEqual({row["name"]: row["total"] for row in r["leaderboard"]}, expected)

    def test_wins_losses_draws_agree_with_matches(self):
        r = run({"coop": COOP, "defect": DEFECT, "tft": TFT}, repetitions=2)
        for row in r["leaderboard"]:
            mine = [m for m in r["matches"] if not m["self_play"]
                    and row["name"] in (m["player_a"], m["player_b"])]
            self.assertEqual(row["wins"], sum(m["winner"] == row["name"] for m in mine))
            self.assertEqual(row["draws"], sum(m["result"] == "draw" for m in mine))
            self.assertEqual(row["losses"], len(mine) - row["wins"] - row["draws"])

    def test_no_self_play_totals_exclude_self_matches(self):
        r = run({"coop": COOP, "defect": DEFECT}, include_self_play=False)
        self.assertEqual({row["name"]: row["total"] for row in r["leaderboard"]},
                         {"defect": 50, "coop": 0})

    def test_seeded_random_streams_have_stable_scoring(self):
        """Golden values cover the isolated per-bot streams and unchanged payoffs."""
        r = run({"coop": COOP, "defect": DEFECT, "tft": TFT, "rnd": RANDOM},
                turns=40, repetitions=2, noise=0.05, seed=7)
        self.assertEqual([(x["name"], x["total"]) for x in r["leaderboard"]],
                         [("defect", 783), ("rnd", 759), ("tft", 697), ("coop", 607)])
        self.assertEqual(r["matrix"]["rnd"],
                         {"coop": 156.0, "defect": 31.5, "rnd": 103.0, "tft": 89.0})

    def test_forfeit_outcome_matches_the_pre_change_baseline(self):
        r = run({"coop": COOP, "defect": DEFECT, "bad": BAD_MOVE}, seed=3)
        self.assertEqual({x["name"]: x["total"] for x in r["leaderboard"]},
                         {"defect": 60, "coop": 30})
        self.assertEqual(r["disqualified"], ["bad"])
        reason = "Invalid Prisoner's Dilemma move 'X'; expected one of: 'AID', 'WITHHOLD'"
        self.assertEqual(r["forfeits"], [
            {"bot": "bad", "opponent": "bad", "repetition": 0, "reason": reason},
            {"bot": "bad", "opponent": "coop", "repetition": 0, "reason": reason},
            {"bot": "bad", "opponent": "defect", "repetition": 0, "reason": reason},
        ])

    def test_original_result_keys_are_preserved(self):
        r = run({1: COOP, 2: DEFECT})
        self.assertEqual(set(r), {"leaderboard", "matrix", "forfeits", "disqualified", "matches"})


class DrawTests(unittest.TestCase):
    def test_equal_scores_are_a_draw(self):
        r = run({"x": COOP, "y": COOP}, include_self_play=False)
        m = r["matches"][0]
        self.assertEqual((m["score_a"], m["score_b"]), (30, 30))
        self.assertEqual((m["result"], m["winner"], m["status"]), ("draw", None, "completed"))
        self.assertEqual([row["draws"] for row in r["leaderboard"]], [1, 1])

    def test_decisive_match_names_the_winner(self):
        m = run({"x": COOP, "y": DEFECT}, include_self_play=False)["matches"][0]
        self.assertEqual((m["result"], m["winner"]), ("b_win", "y"))
        m = run({"x": DEFECT, "y": COOP}, include_self_play=False)["matches"][0]
        self.assertEqual((m["result"], m["winner"]), ("a_win", "x"))

    def test_self_play_has_no_winner(self):
        r = run({"x": COOP})
        [m] = r["matches"]
        self.assertEqual((m["result"], m["winner"], m["self_play"]), ("self_play", None, True))


class FailureTests(unittest.TestCase):
    def check_forfeit_shape(self, r, bad, other, reason_part):
        pair = next(m for m in r["matches"] if not m["self_play"])
        self.assertEqual(pair["status"], "forfeited")
        self.assertIn(reason_part, pair["forfeit_reason"])
        side = 0 if pair["player_a"] == bad else 1
        self.assertEqual(pair["forfeit_side"], side)
        self.assertEqual(pair["winner"], other)
        self.assertEqual((pair["score_a"], pair["score_b"]), (0, 30) if side == 0 else (30, 0))
        self.assertFalse(pair["counted"])
        self.assertEqual(r["disqualified"], [bad])
        self.assertEqual([row["name"] for row in r["leaderboard"]], [other])

    def test_invalid_move(self):
        self.check_forfeit_shape(run({"good": COOP, "bad": BAD_MOVE}), "bad", "good",
                                 "Invalid Prisoner's Dilemma move")

    def test_crash(self):
        self.check_forfeit_shape(run({"good": COOP, "bad": CRASH}), "bad", "good",
                                 "ZeroDivisionError")

    def test_timeout(self):
        old = sandbox.MATCH_TIMEOUT
        sandbox.MATCH_TIMEOUT = 0.3   # workers are forked afterwards and inherit it
        try:
            r = run({"good": COOP, "bad": LOOP}, turns=3)
        finally:
            sandbox.MATCH_TIMEOUT = old
        pair = next(m for m in r["matches"] if not m["self_play"])
        self.assertEqual(pair["status"], "forfeited")
        self.assertIn("timed out", pair["forfeit_reason"])
        bad_side = 0 if pair["player_a"] == "bad" else 1
        self.assertEqual((pair["forfeit_side"], pair["winner"], pair["counted"]),
                         (bad_side, "good", False))
        expected_scores = (0, 9) if bad_side == 0 else (9, 0)
        self.assertEqual((pair["score_a"], pair["score_b"]), expected_scores)

    def test_all_failure_kinds_use_the_same_record_shape(self):
        shapes = set()
        for code in (BAD_MOVE, CRASH):
            for m in run({"good": COOP, "bad": code})["matches"]:
                shapes.add(tuple(sorted(m)))
        self.assertEqual(shapes, {tuple(sorted(MATCH_FIELDS))})

    def test_matches_with_a_disqualified_bot_are_kept_but_not_counted(self):
        r = run({"good": COOP, "bad": BAD_MOVE})
        by_pair = {(m["player_a"], m["player_b"]): m for m in r["matches"]}
        self.assertTrue(by_pair[("good", "good")]["counted"])
        self.assertFalse(by_pair[("bad", "bad")]["counted"])
        self.assertEqual(by_pair[("bad", "bad")]["status"], "forfeited")
        self.assertEqual(by_pair[("bad", "bad")]["result"], "self_play")
        self.assertEqual({row["name"]: row["total"] for row in r["leaderboard"]},
                         totals_from_matches(r["matches"]))

    def test_clean_matches_have_no_forfeit_fields(self):
        for m in run({1: COOP, 2: DEFECT})["matches"]:
            self.assertEqual((m["status"], m["forfeit_side"], m["forfeit_reason"], m["counted"]),
                             ("completed", None, None, True))


class IdentifierTests(unittest.TestCase):
    def test_records_carry_what_the_backend_needs(self):
        r = run({17: COOP, 42: DEFECT, 5: TFT}, repetitions=2, seed=99)
        for m in r["matches"]:
            self.assertEqual(set(m), MATCH_FIELDS)
            self.assertIn(m["player_a"], (17, 42, 5))
            self.assertIn(m["player_b"], (17, 42, 5))
            self.assertIsInstance(m["player_a"], int)
            self.assertEqual(m["seed"], match_seed(99, m["player_a"], m["player_b"], m["repetition"]))
            self.assertTrue(m["winner"] is None or m["winner"] in (m["player_a"], m["player_b"]))

    def test_each_match_is_uniquely_keyed(self):
        r = run({1: COOP, 2: DEFECT, 3: TFT}, repetitions=3)
        keys = [(m["player_a"], m["player_b"], m["repetition"]) for m in r["matches"]]
        self.assertEqual(len(keys), len(set(keys)))

    def test_records_are_json_serializable(self):
        r = run({1: COOP, 2: BAD_MOVE, 3: TFT})
        self.assertEqual(json.loads(json.dumps(r["matches"])), r["matches"])

    def test_unseeded_matches_have_no_seed(self):
        self.assertTrue(all(m["seed"] is None for m in run({1: COOP, 2: DEFECT}, seed=None)["matches"]))


class NoDuplicateExecutionTests(unittest.TestCase):
    def test_every_match_is_played_exactly_once(self):
        calls = []
        real = sandbox._run_in_pool

        def counting(matches, *args, **kwargs):
            calls.append(len(matches))
            return real(matches, *args, **kwargs)

        sandbox._run_in_pool = counting
        try:
            r = run({1: COOP, 2: DEFECT, 3: TFT}, repetitions=2)
        finally:
            sandbox._run_in_pool = real
        self.assertEqual(calls, [len(r["matches"])])   # one pool run, one entry per record

    def test_same_seed_gives_identical_records(self):
        bots = {1: RANDOM, 2: TFT, 3: DEFECT}
        self.assertEqual(run(bots, turns=30, noise=0.1, seed=5)["matches"],
                         run(bots, turns=30, noise=0.1, seed=5)["matches"])


if __name__ == "__main__":
    unittest.main()
