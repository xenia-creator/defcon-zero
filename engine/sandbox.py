"""Validate, load and safely run user-submitted bot code.

The AST checks and restricted builtins block the obvious escapes, and each match
runs in a separate worker process with a time limit. This is not OS-level
isolation: workers still run as the server's user.
"""

import ast
import ctypes
import hashlib
import logging
import math
import multiprocessing
import os
import random
import signal
import threading
import time
import traceback
from collections.abc import Mapping
from types import ModuleType, SimpleNamespace

from .blotto_strategies import BLOTTO_BOTS
from .foreign_aid_strategies import FOREIGN_AID_BOTS
from .games import GAMES, PRISONERS_DILEMMA, get_game
from .match import play_match
from .strategies import BUILT_IN_BOTS
from .tournament import match_seed, schedule, summarize

logger = logging.getLogger(__name__)

MATCH_TIMEOUT = 2.0   # seconds per match, enforced inside the worker
WATCHDOG_GRACE = 1.0  # extra seconds before the parent kills a stuck worker
WORKER_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
_HAS_SIGNAL_TIMER = hasattr(signal, "SIGALRM") and hasattr(signal, "setitimer")
BUILT_IN_BOT_NAMES = set(BUILT_IN_BOTS) | set(BLOTTO_BOTS) | set(FOREIGN_AID_BOTS)


def _builtins_for(game):
    if game.key == "prisoners_dilemma":
        return BUILT_IN_BOTS
    if game.key == "theatre_of_war":
        return BLOTTO_BOTS
    if game.key == "foreign_aid":
        return FOREIGN_AID_BOTS
    raise ValueError(f"No built-in bots are registered for {game.key!r}")

if os.name != "nt":
    try:
        import resource
    except ImportError:
        resource = None
else:
    resource = None

ALLOWED_IMPORTS = {"random", "math"}
BANNED_NAMES = {"open", "eval", "exec", "compile", "__import__", "globals",
                "locals", "getattr", "setattr", "vars"}
# Attributes that reach module internals (random._os) or frames and code objects
BANNED_ATTR_PREFIXES = ("_", "gi_", "cr_", "ag_", "f_", "tb_", "co_")

SAFE_BUILTINS = {f.__name__: f for f in (
    len, range, min, max, sum, abs, list, dict, set, tuple, enumerate, zip,
    any, all, sorted, reversed, int, float, bool, str,
)}


def _identifiers(node):
    """Names a node defines or binds (function names, args, import aliases, ...)."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.arg):
        return [node.arg]
    if isinstance(node, ast.alias):
        return [node.name, node.asname or ""]
    if isinstance(node, ast.keyword):
        return [node.arg or ""]
    if isinstance(node, (ast.Global, ast.Nonlocal)):
        return node.names
    return []


def validate_code(code):
    """Return a list of problems with the bot code. Empty means it is valid."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"Syntax error on line {e.lineno}: {e.msg}"]

    errors = []
    strategies = [n for n in tree.body
                  if isinstance(n, ast.FunctionDef) and n.name == "strategy"]
    if not strategies:
        errors.append("Missing a top-level function strategy(my_history, opp_history).")
    else:
        args = strategies[-1].args
        if (len(args.posonlyargs + args.args) != 2 or args.vararg
                or args.kwarg or args.kwonlyargs):
            errors.append("strategy must take exactly 2 arguments: (my_history, opp_history).")

    for node in ast.walk(tree):
        line = f"Line {getattr(node, 'lineno', '?')}"
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    errors.append(f"{line}: importing '{alias.name}' is not allowed (only random and math).")
        elif isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_IMPORTS:
                errors.append(f"{line}: importing from '{node.module}' is not allowed (only random and math).")
        elif isinstance(node, (ast.Try, ast.TryStar)):
            # Otherwise a bot could catch the timeout and keep running
            errors.append(f"{line}: try/except is not allowed.")
        elif isinstance(node, ast.Name):
            if node.id in BANNED_NAMES:
                errors.append(f"{line}: '{node.id}' is not allowed.")
            elif node.id.startswith("__"):
                errors.append(f"{line}: names starting with '__' are not allowed ('{node.id}').")
        elif isinstance(node, ast.Attribute):
            if node.attr in BANNED_NAMES or node.attr.startswith(BANNED_ATTR_PREFIXES):
                errors.append(f"{line}: attribute '.{node.attr}' is not allowed.")

        for name in _identifiers(node):
            if name.startswith("__"):
                errors.append(f"{line}: names starting with '__' are not allowed ('{name}').")

    return errors


def _module_proxy(module, rng=None):
    """A fresh copy of a module's public functions and constants, so a bot can't
    tamper with the real module or with another bot's copy."""
    public = {}
    for name in dir(module):
        value = getattr(module, name)
        if name.startswith("_") or name == "main" or isinstance(value, (type, ModuleType)):
            continue
        if rng is not None and module is random and callable(value) and hasattr(rng, name):
            public[name] = getattr(rng, name)
            continue
        public[name] = value
    return SimpleNamespace(**public)


def load_bot(code, random_seed=None):
    """Validate and exec bot code in a fresh namespace. Returns its strategy function."""
    errors = validate_code(code)
    if errors:
        raise ValueError("Invalid bot code:\n" + "\n".join(errors))

    modules = {
        "random": _module_proxy(random, random.Random(random_seed)),
        "math": _module_proxy(math),
    }

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name not in modules:
            raise ImportError(f"importing '{name}' is not allowed")
        return modules[name]

    builtins = dict(SAFE_BUILTINS, print=lambda *args, **kwargs: None,
                    __import__=safe_import)
    namespace = {"__builtins__": builtins, **modules}
    exec(compile(code, "<bot>", "exec"), namespace)

    strategy = namespace.get("strategy")
    if not callable(strategy):
        raise ValueError("strategy is not a function.")
    return strategy


# --- Worker side ----------------------------------------------------------

class MatchTimeout(BaseException):
    """Raised by SIGALRM when a match runs past MATCH_TIMEOUT."""


class BadMove(Exception):
    """A bot returned a move invalid for the selected game."""


# Shared arrays indexed by match: when it started, and which side (0/1) is moving
_started = None
_running = None
_worker_job_handle = None
# Taken once and never released, so only the first thread to see a failed memory
# limit logs it. Every check starts new workers, so warning from them would repeat.
_memory_limit_warning = threading.Lock()


def _apply_windows_memory_limit():
    global _worker_job_handle
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = ctypes.c_void_p
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p)
    kernel32.SetInformationJobObject.argtypes = (
        ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint,
    )
    kernel32.AssignProcessToJobObject.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p

    class BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", ctypes.c_uint32),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", ctypes.c_uint32),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", ctypes.c_uint32),
            ("SchedulingClass", ctypes.c_uint32),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

    class ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimitInformation),
            ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    information = ExtendedLimitInformation()
    information.BasicLimitInformation.LimitFlags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
    information.ProcessMemoryLimit = WORKER_MEMORY_LIMIT_BYTES
    if not kernel32.SetInformationJobObject(
        job, 9, ctypes.byref(information), ctypes.sizeof(information)
    ):
        error = ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(job)
        raise error
    if not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess()):
        error = ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(job)
        raise error
    _worker_job_handle = job


def _apply_worker_memory_limit():
    if os.name == "nt":
        _apply_windows_memory_limit()
        return
    if resource is None or not hasattr(resource, "RLIMIT_AS"):
        raise RuntimeError("This platform has no supported worker memory-limit mechanism")
    _, hard_limit = resource.getrlimit(resource.RLIMIT_AS)
    target = WORKER_MEMORY_LIMIT_BYTES
    if hard_limit != resource.RLIM_INFINITY:
        target = min(target, hard_limit)
    resource.setrlimit(resource.RLIMIT_AS, (target, target))


def _init_worker(started, running, memory_limit_failed):
    global _started, _running
    _started, _running = started, running
    try:
        _apply_worker_memory_limit()
    except Exception:
        # Some hosts cannot set the limit (macOS refuses RLIMIT_AS). The bot still
        # runs, without the cap, so that every check does not fail there. The
        # parent logs the warning. Linux sets the limit, so it stays enforced.
        memory_limit_failed.value = 1
    if _HAS_SIGNAL_TIMER:
        signal.signal(signal.SIGALRM, _on_alarm)


def _on_alarm(signum, frame):
    raise MatchTimeout


def _forfeit(side, turns, reason):
    """Result when `side` forfeits: 0 for them, 3 per turn for the opponent."""
    scores = (0, 3 * turns) if side == 0 else (3 * turns, 0)
    return scores + ((side, reason),)


def _bot_line(error):
    """' (line N)' for the deepest frame of bot code in the traceback, if any."""
    lines = [f.lineno for f in traceback.extract_tb(error.__traceback__) if f.filename == "<bot>"]
    return f" (line {lines[-1]})" if lines else ""


def _load(source, game, random_seed=None):
    """A source is either a built-in bot name or code."""
    bots = _builtins_for(game)
    if source in bots:
        return bots[source]
    if source in BUILT_IN_BOT_NAMES:
        raise ValueError(f"Built-in bot {source!r} belongs to a different game")
    return load_bot(source, random_seed)


def _play_job(index, sources, game, turns, noise, seed, bot_seeds, record=False):
    """Play one match in a worker. Returns (score1, score2, forfeit or None), plus
    (history1, history2) when `record` is set. On a forfeit the histories hold
    every turn completed before it."""
    _started[index] = time.monotonic()
    histories = ([], [])

    def guard(bot, side):
        def move(my_history, opp_history):
            nonlocal histories
            if record and len(my_history) == len(opp_history):
                # The first action of each turn sees only completed-turn history.
                histories = (
                    (my_history.copy(), opp_history.copy())
                    if side == 0
                    else (opp_history.copy(), my_history.copy())
                )
            _running[index] = side
            m = bot(my_history, opp_history)
            if game.key == "foreign_aid":
                receiving = len(opp_history) > len(my_history)
                error = game.validate_action(
                    m,
                    role="receiver" if receiving else "sender",
                    sent=opp_history[-1] if receiving else None,
                )
            else:
                error = game.validate_action(m)
            if error:
                raise BadMove(error)
            return m
        return move

    if _HAS_SIGNAL_TIMER:
        signal.setitimer(signal.ITIMER_REAL, MATCH_TIMEOUT)
    try:
        # Load each side separately so self-play gets two independent copies
        bots = []
        for side in (0, 1):
            _running[index] = side
            bots.append(guard(_load(sources[side], game, bot_seeds[side]), side))
        result = play_match(
            bots[0], bots[1], game, turns, noise, seed,
            bot_random_seeds=bot_seeds,
        )
        outcome = (result["score1"], result["score2"], None)
        histories = (result["history1"], result["history2"])
    except MatchTimeout:
        outcome = _forfeit(_running[index], turns, f"timed out after {MATCH_TIMEOUT:g}s")
    except BadMove as e:
        outcome = _forfeit(_running[index], turns, str(e))
    except BaseException as e:
        outcome = _forfeit(_running[index], turns, f"raised {type(e).__name__}: {e}{_bot_line(e)}")
    finally:
        if _HAS_SIGNAL_TIMER:
            signal.setitimer(signal.ITIMER_REAL, 0)
    return outcome + histories if record else outcome


def _bot_seed(seed, name, side):
    if seed is None:
        return None
    material = f"{seed}|participant|{name}|side|{side}".encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big")


# --- Parent side ----------------------------------------------------------

def _run_in_pool(matches, sources, game, turns, noise, seed, record=False):
    """Play every match in a worker pool. Returns one (score1, score2, forfeit) per match,
    with (history1, history2) appended when `record` is set.

    Workers time themselves out with SIGALRM. As a backstop (e.g. a bot stuck in a
    long C call, which ignores signals), the parent kills the pool when a match runs
    past the deadline, forfeits the bot that was moving, and reruns unfinished matches.
    """
    started = multiprocessing.Array("d", len(matches), lock=False)
    running = multiprocessing.Array("i", len(matches), lock=False)
    memory_limit_failed = multiprocessing.Value("b", 0, lock=False)
    outcomes = [None] * len(matches)
    todo = list(range(len(matches)))

    while todo:
        for i in todo:
            started[i] = 0.0
        stuck = []
        workers = min(len(todo), os.cpu_count() or 1)
        with multiprocessing.Pool(workers, initializer=_init_worker, initargs=(started, running, memory_limit_failed)) as pool:
            pending = {}
            for i in todo:
                rep, a, b = matches[i]
                this_seed = match_seed(seed, a, b, rep)
                args = (
                    i, (sources[a], sources[b]), game, turns, noise, this_seed,
                    (_bot_seed(this_seed, a, 0), _bot_seed(this_seed, b, 1)), record,
                )
                pending[i] = pool.apply_async(_play_job, args)

            while pending and not stuck:
                time.sleep(0.01)
                for i in [i for i, r in pending.items() if r.ready()]:
                    outcomes[i] = pending.pop(i).get()
                now = time.monotonic()
                stuck = [i for i in pending
                         if started[i] and now - started[i] > MATCH_TIMEOUT + WATCHDOG_GRACE]
        # Leaving the `with` block terminates the pool, killing stuck workers

        for i in stuck:
            outcomes[i] = _forfeit(running[i], turns, f"timed out after {MATCH_TIMEOUT:g}s (worker killed)")
            if record:
                outcomes[i] += ([], [])
        todo = [i for i in pending if i not in stuck]

    if memory_limit_failed.value and _memory_limit_warning.acquire(blocking=False):
        logger.warning("Worker memory limit could not be set; bots run without it.")
    return outcomes


def run_safe_round_robin(bot_codes, game, turns, repetitions=1, noise=0.0, seed=None,
                         include_self_play=True):
    """Like run_round_robin, but bots are code strings run in worker processes.

    bot_codes maps participant names to code strings. A bot that raises,
    returns a bad move or times out forfeits that match and is disqualified from
    the round: all of its matches are dropped, so every remaining bot is scored
    on the same opponents. Match records include forfeits, but only completed
    matches between qualified bots contribute to the aggregate. Returns the
    run_round_robin result plus "forfeits", "disqualified" and "matches".
    """
    game = get_game(game)
    if not isinstance(bot_codes, Mapping):
        raise TypeError("bot_codes must be a mapping of participant names to code")
    if not hasattr(game, "actions") or not callable(getattr(game, "score", None)):
        raise TypeError("game must be a game instance")
    if not isinstance(turns, int) or isinstance(turns, bool):
        raise TypeError("turns must be an integer")
    if turns < 1:
        raise ValueError("turns must be at least 1")
    if isinstance(noise, bool) or not isinstance(noise, (int, float)):
        raise TypeError("noise must be a number")
    if not math.isfinite(noise) or not 0 <= noise <= 1:
        raise ValueError("noise must be between 0 and 1")
    if not isinstance(include_self_play, bool):
        raise TypeError("include_self_play must be a bool")

    if not getattr(game, "configured", True):
        raise NotImplementedError(f"{game.name} rules are pending team approval")
    sources = dict(bot_codes)
    for name, source in sources.items():
        if not isinstance(source, str):
            raise TypeError(f"Bot {name!r} source must be code text")
        if source in BUILT_IN_BOT_NAMES:
            raise ValueError(f"Bot {name!r} cannot use a built-in as a tournament participant")
        errors = validate_code(source)
        if errors:
            raise ValueError(f"Bot {name!r} is invalid: " + " ".join(errors))

    names = sorted(sources)
    matches = schedule(names, repetitions, include_self_play)
    outcomes = _run_in_pool(matches, sources, game, turns, noise, seed) if matches else []

    results, forfeits = [], []
    records = []
    for (rep, a, b), (sa, sb, forfeit) in zip(matches, outcomes):
        results.append((a, b, sa, sb))
        is_self_play = a == b
        if is_self_play or (not forfeit and sa == sb):
            winner = None
        elif forfeit:
            winner = b if forfeit[0] == 0 else a
        else:
            winner = a if sa > sb else b
        record = {
            "player_a": a,
            "player_b": b,
            "repetition": rep,
            "seed": match_seed(seed, a, b, rep),
            "status": "forfeited" if forfeit else "completed",
            "score_a": sa,
            "score_b": sb,
            "result": "self_play" if is_self_play else (
                "draw" if sa == sb else "a_win" if sa > sb else "b_win"
            ),
            "winner": winner,
            "forfeit_side": forfeit[0] if forfeit else None,
            "forfeit_reason": forfeit[1] if forfeit else None,
            "self_play": is_self_play,
            "counted": not forfeit,
        }
        records.append(record)
        if forfeit:
            side, reason = forfeit
            forfeits.append({
                "bot": (a, b)[side],
                "opponent": (b, a)[side],
                "repetition": rep,
                "reason": reason,
            })

    disqualified = {f["bot"] for f in forfeits}
    for record in records:
        if record["player_a"] in disqualified or record["player_b"] in disqualified:
            record["counted"] = False
    remaining = [name for name in names if name not in disqualified]
    results = [r for r in results if r[0] not in disqualified and r[1] not in disqualified]

    summary = summarize(remaining, results, turns, repetitions)
    summary["forfeits"] = forfeits
    summary["disqualified"] = [name for name in names if name in disqualified]
    summary["matches"] = records
    return summary


def play_safe_match(name1, name2, bot_codes, game, turns, noise=0.0, seed=None):
    """Play one match between two bots in the sandbox and keep the full record.

    bot_codes maps name -> code or built-in name, as in run_safe_round_robin.
    The match seed is derived the same way as in a round robin, so the replay
    matches repetition 0 of a tournament run with the same seed.

    Returns {"history1", "history2", "score1", "score2", "forfeit"}, where forfeit
    is None or {"side": 0 or 1, "reason": ...}. On a forfeit the histories stop
    at the last completed turn and the scores are the forfeit scores.
    """
    game = get_game(game)
    if not getattr(game, "configured", True):
        raise NotImplementedError(f"{game.name} rules are pending team approval")
    for name in (name1, name2):
        if bot_codes[name] not in _builtins_for(game):
            if bot_codes[name] in BUILT_IN_BOT_NAMES:
                raise ValueError(f"Built-in bot {bot_codes[name]!r} belongs to a different game")
            errors = validate_code(bot_codes[name])
            if errors:
                raise ValueError(f"Bot {name!r} is invalid: " + " ".join(errors))

    sources = {name1: bot_codes[name1], name2: bot_codes[name2]}
    [(score1, score2, forfeit, history1, history2)] = _run_in_pool(
        [(0, name1, name2)], sources, game, turns, noise, seed, record=True,
    )
    return {
        "history1": history1,
        "history2": history2,
        "score1": score1,
        "score2": score2,
        "forfeit": None if forfeit is None else {"side": forfeit[0], "reason": forfeit[1]},
    }


def test_submission(code, game=PRISONERS_DILEMMA, turns=50):
    """Run a submission against every built-in for its selected configured game.

    The returned shape matches the backend's SubmissionCheck:
    {"error": str | None, "test_results": [{"opponent", "my_score", "opp_score"}]}.
    """
    try:
        game = get_game(game)
    except (TypeError, ValueError) as error:
        return {"error": str(error), "test_results": []}
    if not getattr(game, "configured", True):
        return {
            "error": "Trust game rules are pending team approval",
            "test_results": [],
        }
    errors = validate_code(code)
    if errors:
        return {"error": " ".join(errors), "test_results": []}

    opponents = list(_builtins_for(game))
    sources = {"submission": code, **{name: name for name in opponents}}
    matches = [(0, "submission", name) for name in opponents]
    outcomes = _run_in_pool(
        matches, sources, game, turns, 0.0, seed=0,
    )

    errors = []
    test_results = []
    for name, (score1, score2, forfeit) in zip(opponents, outcomes):
        test_results.append({
            "opponent": name,
            "my_score": score1,
            "opp_score": score2,
        })
        if forfeit:
            side, reason = forfeit
            who = "Your bot" if side == 0 else name
            errors.append(f"Against {name}: {who} {reason}")
    return {"error": "; ".join(errors) if errors else None, "test_results": test_results}
