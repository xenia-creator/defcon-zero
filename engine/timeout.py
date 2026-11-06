"""Time limit for a guarded match.

This is separate from the sandbox. The sandbox still enforces its own limit
for submitted code and is not used here.
"""

import multiprocessing
import time
from queue import Empty


class BotTimeout(Exception):
    """The bot did not return before the limit."""

    def __init__(self, timeout):
        self.timeout = timeout
        super().__init__(f"timed out after {timeout:g}s")


class RemoteFailure(Exception):
    """A bot raised while running in the timeout process."""

    def __init__(self, type_name, message):
        self.type_name = type_name
        super().__init__(message)


def unresponsive_cooperate(my_history, opp_history):
    """Valid cooperate bot that never returns in time. Used by the timeout test."""
    time.sleep(30)
    return "C"


def _run(func, args, queue):
    try:
        queue.put(("ok", func(*args)))
    except Exception as exc:
        queue.put(("err", (type(exc).__name__, str(exc))))


def _stop(process):
    if not process.is_alive():
        return
    process.terminate()
    process.join(5)
    if process.is_alive():
        process.kill()
        process.join(5)


def call_with_timeout(func, args, timeout):
    """Call `func(*args)` in a child process and terminate it if it overruns."""
    ctx = multiprocessing.get_context("spawn")
    result = ctx.Queue()
    process = ctx.Process(target=_run, args=(func, args, result))
    process.start()
    try:
        try:
            status, payload = result.get(timeout=timeout)
        except Empty:
            if process.is_alive():
                _stop(process)
                raise BotTimeout(timeout)
            raise RemoteFailure("RuntimeError", "bot process ended without a move")
        process.join(1)
        _stop(process)
        if status == "ok":
            return payload
        type_name, message = payload
        raise RemoteFailure(type_name, message)
    finally:
        if process.is_alive():
            _stop(process)
        result.close()
        process.join(1)
        if not process.is_alive():
            process.close()
