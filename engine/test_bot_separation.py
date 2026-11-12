"""Built-in bots are for submission testing; the tournament runs participants only."""

import unittest

from engine import registry, sandbox
from engine.games import (
    FOREIGN_AID,
    GAMES,
    PRISONERS_DILEMMA as PD,
    THEATRE_OF_WAR,
)
from engine.strategies import BUILT_IN_BOTS as PD_BOTS
from engine.blotto_strategies import BLOTTO_BOTS
from engine.foreign_aid_strategies import FOREIGN_AID_BOTS
from engine.tournament import schedule

COOP = "def strategy(my_history, opp_history):\n    return 'C'\n"
DEFECT = "def strategy(my_history, opp_history):\n    return 'D'\n"
TFT = "def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else 'C'\n"
BAD_MOVE = "def strategy(my_history, opp_history):\n    return 'X'\n"


def run(bots, turns=10, repetitions=1, seed=1, **kwargs):
    return sandbox.run_safe_round_robin(bots, PD, turns, repetitions, 0.0, seed, **kwargs)


class BuiltInsStayAvailableTests(unittest.TestCase):
    def test_registry_still_holds_every_built_in(self):
        self.assertEqual(len(PD_BOTS), 10)
        self.assertEqual(len(BLOTTO_BOTS), 5)
        self.assertEqual(len(FOREIGN_AID_BOTS), 4)
        self.assertEqual(set(registry.bots_for(PD)), set(PD_BOTS))
        self.assertEqual(set(registry.bots_for(THEATRE_OF_WAR)), set(BLOTTO_BOTS))
        self.assertEqual(set(registry.bots_for(FOREIGN_AID)), set(FOREIGN_AID_BOTS))
        self.assertEqual(set(GAMES), {
            "prisoners_dilemma", "theatre_of_war", "foreign_aid",
        })

    def test_submission_testing_still_plays_against_built_ins(self):
        result = sandbox.test_submission(COOP, turns=10)
        self.assertIsNone(result["error"])
        self.assertEqual(len(result["test_results"]), len(PD_BOTS))
        self.assertTrue(all({"opponent", "my_score", "opp_score"} == set(row)
                            for row in result["test_results"]))

    def test_submission_testing_reports_a_bad_submission(self):
        result = sandbox.test_submission(BAD_MOVE, turns=5)
        self.assertIn("Invalid Prisoner's Dilemma move", result["error"])
        self.assertEqual(len(result["test_results"]), len(PD_BOTS))

    def test_a_single_match_can_still_use_a_built_in(self):
        r = sandbox.play_safe_match("mine", "ref", {"mine": COOP, "ref": "always_defect"},
                                    PD, 5, noise=0, seed=1)
        self.assertEqual((r["score1"], r["score2"], r["forfeit"]), (0, 25, None))

    def test_submission_testing_does_not_depend_on_the_tournament_runner(self):
        real = sandbox.run_safe_round_robin

        def boom(*args, **kwargs):
            raise AssertionError("submission testing must not run a tournament")

        sandbox.run_safe_round_robin = boom
        try:
            self.assertIsNone(sandbox.test_submission(DEFECT, turns=5)["error"])
        finally:
            sandbox.run_safe_round_robin = real

    def test_same_random_builtin_name_resolves_per_game_in_the_sandbox(self):
        blotto = sandbox.play_safe_match(
            "left", "right", {"left": "random", "right": "random"},
            THEATRE_OF_WAR, 2, seed=3,
        )
        trust = sandbox.play_safe_match(
            "left", "right", {"left": "random", "right": "random"},
            FOREIGN_AID, 2, seed=3,
        )
        self.assertIsNone(blotto["forfeit"])
        self.assertIsNone(trust["forfeit"])
        self.assertTrue(all(
            len(move) == 5 and sum(move) == 100
            for move in blotto["history1"] + blotto["history2"]
        ))

    def test_submission_testing_runs_against_foreign_aid_builtins(self):
        result = sandbox.test_submission(
            "def strategy(my_history, opp_history):\n    return 0\n",
            FOREIGN_AID,
            turns=4,
        )
        self.assertIsNone(result["error"])
        self.assertEqual(len(result["test_results"]), len(FOREIGN_AID_BOTS))

    def test_foreign_aid_sandbox_preserves_completed_turn_histories_on_forfeit(self):
        first = (
            "def strategy(my_history, opp_history):\n"
            "    return 31 if len(opp_history) > len(my_history) else 10\n"
        )
        second = (
            "def strategy(my_history, opp_history):\n"
            "    return 10 if len(my_history) == len(opp_history) else 0\n"
        )
        result = sandbox.play_safe_match(
            "first", "second", {"first": first, "second": second},
            FOREIGN_AID, 3, seed=2,
        )
        self.assertEqual(result["forfeit"]["side"], 0)
        self.assertEqual(result["history1"], [10])
        self.assertEqual(result["history2"], [0])


class BuiltInsStayOutOfTheTournamentTests(unittest.TestCase):
    def test_only_the_supplied_participants_play(self):
        r = run({101: COOP, 102: DEFECT})
        self.assertEqual({x["name"] for x in r["leaderboard"]}, {101, 102})
        players = {m["player_a"] for m in r["matches"]} | {m["player_b"] for m in r["matches"]}
        self.assertEqual(players, {101, 102})
        self.assertFalse(players & (set(PD_BOTS) | set(BLOTTO_BOTS)))

    def test_include_builtins_option_is_gone(self):
        with self.assertRaises(TypeError):
            sandbox.run_safe_round_robin({1: COOP}, game=PD, turns=5, include_builtins=True)

    def test_old_style_call_fails_loudly(self):
        # The old signature was (bot_codes, include_builtins, game, turns, ...)
        with self.assertRaises((TypeError, ValueError)):
            sandbox.run_safe_round_robin({1: COOP}, False, PD, 5)
        with self.assertRaises((TypeError, ValueError)):
            sandbox.run_safe_round_robin({1: COOP}, False, PD, 5, 1, 0.0)

    def test_built_in_name_is_rejected_as_a_participant(self):
        for name in (*PD_BOTS, *BLOTTO_BOTS, *FOREIGN_AID_BOTS):
            with self.assertRaises(ValueError) as ctx:
                run({"mine": COOP, "sneaky": name})
            self.assertIn("built-in", str(ctx.exception))

    def test_non_code_participant_is_rejected(self):
        with self.assertRaises(TypeError):
            run({"mine": COOP, "func": PD_BOTS["tit_for_tat"]})

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
            sandbox.run_safe_round_robin({}, PD, "five")

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
        self.assertEqual(got, schedule(sorted(bots), 3))
        self.assertEqual(len(got), 3 * (4 + 6))                      # self-play + pairings
        pairs = [m for m in r["matches"] if not m["self_play"]]
        self.assertEqual(len(pairs), 3 * 6)
        r = run(bots, repetitions=3, include_self_play=False)
        self.assertEqual(len(r["matches"]), 3 * 6)
        for rep in range(3):
            seen = [(m["player_a"], m["player_b"]) for m in r["matches"] if m["repetition"] == rep]
            self.assertEqual(sorted(seen), [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)])


class ParticipantBoundaryTests(unittest.TestCase):
    def test_tournaments_use_only_explicitly_supplied_participants(self):
        result = run({"team-b": COOP, "team-a": DEFECT})
        self.assertEqual([m["player_a"] for m in result["matches"]], [
            "team-a", "team-b", "team-a",
        ])
        self.assertEqual({row["name"] for row in result["leaderboard"]},
                         {"team-a", "team-b"})

    def test_event_orchestration_is_not_part_of_the_engine(self):
        import importlib.util
        self.assertIsNone(importlib.util.find_spec("engine.event"))

    def test_game_keys_are_exactly_the_backend_keys(self):
        self.assertEqual(tuple(GAMES), (
            "prisoners_dilemma", "theatre_of_war", "foreign_aid",
        ))


if __name__ == "__main__":
    unittest.main()
