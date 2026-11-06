"""Built-in bots are for submission testing; the tournament runs participants only."""

import unittest

from engine import registry, sandbox
from engine.event import RoundConfig, run_event
from engine.games import PRISONERS_DILEMMA as PD
from engine.strategies import BUILT_IN_BOTS
from engine.tournament import schedule

COOP = "def strategy(my_history, opp_history):\n    return 'C'\n"
DEFECT = "def strategy(my_history, opp_history):\n    return 'D'\n"
TFT = "def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else 'C'\n"
BAD_MOVE = "def strategy(my_history, opp_history):\n    return 'X'\n"


def run(bots, turns=10, repetitions=1, seed=1, **kwargs):
    return sandbox.run_safe_round_robin(bots, PD, turns, repetitions, 0.0, seed, **kwargs)


class BuiltInsStayAvailableTests(unittest.TestCase):
    def test_registry_still_holds_every_built_in(self):
        self.assertEqual(len(BUILT_IN_BOTS), 9)
        self.assertEqual(set(registry.bots_for(PD)), set(BUILT_IN_BOTS))

    def test_submission_testing_still_plays_against_built_ins(self):
        self.assertEqual(sandbox.test_submission(COOP, turns=10), {"ok": True, "errors": []})

    def test_submission_testing_reports_a_bad_submission(self):
        result = sandbox.test_submission(BAD_MOVE, turns=5)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["errors"]), 3)    # one per built-in opponent

    def test_a_single_match_can_still_use_a_built_in(self):
        r = sandbox.play_safe_match("mine", "ref", {"mine": COOP, "ref": "always_defect"},
                                    PD, 5, seed=1)
        self.assertEqual((r["score1"], r["score2"], r["forfeit"]), (0, 25, None))

    def test_submission_testing_does_not_depend_on_the_tournament_runner(self):
        real = sandbox.run_safe_round_robin

        def boom(*args, **kwargs):
            raise AssertionError("submission testing must not run a tournament")

        sandbox.run_safe_round_robin = boom
        try:
            self.assertTrue(sandbox.test_submission(DEFECT, turns=5)["ok"])
        finally:
            sandbox.run_safe_round_robin = real


class BuiltInsStayOutOfTheTournamentTests(unittest.TestCase):
    def test_only_the_supplied_participants_play(self):
        r = run({101: COOP, 102: DEFECT})
        self.assertEqual({x["name"] for x in r["leaderboard"]}, {101, 102})
        players = {m["player_a"] for m in r["matches"]} | {m["player_b"] for m in r["matches"]}
        self.assertEqual(players, {101, 102})
        self.assertFalse(players & set(BUILT_IN_BOTS))

    def test_include_builtins_option_is_gone(self):
        with self.assertRaises(TypeError):
            sandbox.run_safe_round_robin({1: COOP}, game=PD, turns=5, include_builtins=True)

    def test_old_style_call_fails_loudly(self):
        # The old signature was (bot_codes, include_builtins, game, turns, ...)
        with self.assertRaises(TypeError):
            sandbox.run_safe_round_robin({1: COOP}, False, PD, 5)
        with self.assertRaises(TypeError):
            sandbox.run_safe_round_robin({1: COOP}, False, PD, 5, 1, 0.0)

    def test_built_in_name_is_rejected_as_a_participant(self):
        for name in BUILT_IN_BOTS:
            with self.assertRaises(ValueError) as ctx:
                run({"mine": COOP, "sneaky": name})
            self.assertIn("built-in", str(ctx.exception))

    def test_non_code_participant_is_rejected(self):
        with self.assertRaises(TypeError):
            run({"mine": COOP, "func": BUILT_IN_BOTS["tit_for_tat"]})

    def test_invalid_code_is_still_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            run({"evil": "import os\n" + COOP})
        self.assertIn("Bot 'evil' is invalid", str(ctx.exception))


class ParticipantTournamentTests(unittest.TestCase):
    def test_accepts_participant_submissions_by_integer_id(self):
        r = run({7: COOP, 9: DEFECT, 12: TFT})
        self.assertEqual({x["name"] for x in r["leaderboard"]}, {7, 9, 12})
        self.assertEqual(r["disqualified"], [])

    def test_empty_participant_list(self):
        real = sandbox._run_in_pool
        sandbox._run_in_pool = lambda *a, **k: self.fail("no workers should start")
        try:
            r = run({})
        finally:
            sandbox._run_in_pool = real
        self.assertEqual(r, {"leaderboard": [], "matrix": {}, "forfeits": [],
                             "disqualified": [], "matches": []})

    def test_empty_list_still_checks_arguments(self):
        with self.assertRaises(TypeError):
            sandbox.run_safe_round_robin({}, False, PD, 5)

    def test_single_participant(self):
        r = run({1: COOP})
        self.assertEqual([m["self_play"] for m in r["matches"]], [True])
        r = run({1: COOP}, include_self_play=False)
        self.assertEqual(r["matches"], [])
        self.assertEqual([(x["name"], x["total"]) for x in r["leaderboard"]], [(1, 0)])

    def test_multiple_participants_generate_the_expected_round_robin(self):
        bots = {1: COOP, 2: DEFECT, 3: TFT, 4: COOP}
        r = run(bots, repetitions=3)
        got = [(m["repetition"], m["player_a"], m["player_b"]) for m in r["matches"]]
        self.assertEqual(got, schedule(list(bots), 3))
        self.assertEqual(len(got), 3 * (4 + 6))                      # self-play + pairings
        pairs = [m for m in r["matches"] if not m["self_play"]]
        self.assertEqual(len(pairs), 3 * 6)
        r = run(bots, repetitions=3, include_self_play=False)
        self.assertEqual(len(r["matches"]), 3 * 6)
        for rep in range(3):
            seen = [(m["player_a"], m["player_b"]) for m in r["matches"] if m["repetition"] == rep]
            self.assertEqual(sorted(seen), [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)])


class EventTests(unittest.TestCase):
    ROUNDS = [RoundConfig("r1", PD, 10, repetitions=1, keep_fraction=0.5)]
    BOTS = {"a": COOP, "b": DEFECT, "c": TFT, "d": COOP}

    def test_event_has_no_builtin_option(self):
        with self.assertRaises(TypeError):
            run_event(self.BOTS, self.ROUNDS, seed=1, include_builtins=True)

    def test_event_plays_participants_only_and_exposes_matches(self):
        r = run_event(self.BOTS, self.ROUNDS, seed=1)
        first = r["rounds"][0]
        self.assertEqual({x["name"] for x in first["leaderboard"]}, set(self.BOTS))
        self.assertEqual(len(first["matches"]), 4 + 6)
        self.assertTrue(set(first["advanced"]) <= set(self.BOTS))

    def test_event_self_play_follows_the_round_config(self):
        rounds = [RoundConfig("r1", PD, 10, repetitions=1, include_self_play=False)]
        first = run_event(self.BOTS, rounds, seed=1)["rounds"][0]
        self.assertEqual(len(first["matches"]), 6)
        self.assertFalse(any(m["self_play"] for m in first["matches"]))

    def test_event_rejects_a_built_in_name_as_a_bot(self):
        with self.assertRaises(ValueError):
            run_event({"a": COOP, "b": "tit_for_tat"}, self.ROUNDS, seed=1)


if __name__ == "__main__":
    unittest.main()
