"""Worker-pool sizing from task count and environment configuration."""

import os
import unittest
from unittest import mock

from engine import sandbox
from engine.games import PRISONERS_DILEMMA


class WorkerLimitTests(unittest.TestCase):
    def run_with_mocked_pool(self, task_count):
        pool = mock.MagicMock()
        result = mock.MagicMock()
        result.ready.return_value = True
        result.get.return_value = (0, 0, None)
        pool.__enter__.return_value.apply_async.return_value = result
        matches = [(index, "a", "b") for index in range(task_count)]
        sources = {"a": "source a", "b": "source b"}

        with mock.patch.object(sandbox.multiprocessing, "Pool", return_value=pool) as pool_factory:
            with mock.patch.object(sandbox.time, "sleep"):
                outcomes = sandbox._run_in_pool(
                    matches, sources, PRISONERS_DILEMMA, 1, 0.0, 1,
                )
        return pool_factory, outcomes

    def test_configured_worker_limit(self):
        with mock.patch.dict(os.environ, {"ENGINE_MAX_WORKERS": "4"}):
            pool_factory, outcomes = self.run_with_mocked_pool(6)

        self.assertEqual(pool_factory.call_args.args[0], 4)
        self.assertEqual(len(outcomes), 6)

    def test_cpu_count_fallback(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch.object(sandbox.os, "cpu_count", return_value=3):
                pool_factory, outcomes = self.run_with_mocked_pool(6)

        self.assertEqual(pool_factory.call_args.args[0], 3)
        self.assertEqual(len(outcomes), 6)

    def test_configured_limit_is_capped_by_task_count(self):
        with mock.patch.dict(os.environ, {"ENGINE_MAX_WORKERS": "4"}):
            pool_factory, outcomes = self.run_with_mocked_pool(2)

        self.assertEqual(pool_factory.call_args.args[0], 2)
        self.assertEqual(len(outcomes), 2)

    def test_empty_task_list_does_not_create_a_pool(self):
        with mock.patch.dict(os.environ, {"ENGINE_MAX_WORKERS": "invalid"}):
            pool_factory, outcomes = self.run_with_mocked_pool(0)

        pool_factory.assert_not_called()
        self.assertEqual(outcomes, [])

    def test_invalid_worker_limits_are_rejected(self):
        for value in ("invalid", "0"):
            with self.subTest(value=value):
                with mock.patch.dict(os.environ, {"ENGINE_MAX_WORKERS": value}):
                    with mock.patch.object(sandbox.multiprocessing, "Pool") as pool_factory:
                        with self.assertRaisesRegex(
                            ValueError, "ENGINE_MAX_WORKERS must be a positive integer",
                        ):
                            sandbox._run_in_pool(
                                [(0, "a", "b")],
                                {"a": "source a", "b": "source b"},
                                PRISONERS_DILEMMA, 1, 0.0, 1,
                            )
                pool_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
