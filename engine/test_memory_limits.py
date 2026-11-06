import unittest
import multiprocessing

from engine import sandbox
from engine.games import PRISONERS_DILEMMA


def _check_worker_limit(queue):
    try:
        sandbox._apply_worker_memory_limit()
    except Exception as error:
        queue.put(f"{type(error).__name__}: {error}")
    else:
        queue.put(None)


class WorkerMemoryLimitTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
