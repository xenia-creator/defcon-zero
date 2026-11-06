import sys
import threading
import unittest
import multiprocessing
from unittest import mock

from engine import sandbox
from engine.games import PRISONERS_DILEMMA


# macOS refuses RLIMIT_AS, so workers there fall back to running without the limit.
NO_MEMORY_LIMIT = sys.platform == "darwin"


def _check_worker_limit(queue):
    try:
        sandbox._apply_worker_memory_limit()
    except Exception as error:
        queue.put(f"{type(error).__name__}: {error}")
    else:
        queue.put(None)


class WorkerMemoryLimitTests(unittest.TestCase):
    @unittest.skipIf(NO_MEMORY_LIMIT, "macOS cannot set the worker memory limit")
    def test_worker_limit_is_configured_and_applied(self):
        self.assertGreater(sandbox.WORKER_MEMORY_LIMIT_BYTES, 0)
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        process = context.Process(target=_check_worker_limit, args=(queue,))
        process.start()
        process.join(10)
        if process.is_alive():
            process.kill()
            process.join()
            self.fail("memory-limit worker did not exit")
        self.assertEqual(process.exitcode, 0)
        self.assertIsNone(queue.get(timeout=1))
        queue.close()

    @unittest.skipIf(NO_MEMORY_LIMIT, "macOS cannot set the worker memory limit")
    def test_memory_exhausting_bot_is_forfeited_and_disqualified(self):
        memory_bot = (
            "def strategy(my_history, opp_history):\n"
            "    values = [0] * 70000000\n"
            "    return 'C'\n"
        )
        result = sandbox.run_safe_round_robin(
            {1: memory_bot}, PRISONERS_DILEMMA, turns=1,
        )
        self.assertEqual(result["disqualified"], [1])
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(result["matches"][0]["status"], "forfeited")
        self.assertIn("MemoryError", result["matches"][0]["forfeit_reason"])

    @unittest.skipUnless(NO_MEMORY_LIMIT, "only macOS falls back")
    def test_bots_run_with_one_warning_when_the_limit_cannot_be_set(self):
        bot = "def strategy(my_history, opp_history):\n    return 'C'\n"
        # A fresh lock, in case an earlier test in this process already warned.
        with mock.patch.object(sandbox, "_memory_limit_warning", threading.Lock()):
            with self.assertLogs("engine.sandbox", "WARNING") as logs:
                results = [
                    sandbox.run_safe_round_robin({1: bot}, PRISONERS_DILEMMA, turns=1)
                    for _ in range(2)
                ]
        self.assertEqual(len(logs.records), 1)
        for result in results:
            self.assertEqual(result["disqualified"], [])
            self.assertEqual(result["matches"][0]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
