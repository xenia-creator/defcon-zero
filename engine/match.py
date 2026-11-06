"""Play a single repeated match between two bots."""

import copy
import random
import hashlib

from .noise import apply_noise
from .games import get_game


class Forfeit(Exception):
    """A bot crashed, timed out, or returned an action this game does not use."""

    def __init__(self, side, reason):
        self.side = side
        self.reason = reason
        super().__init__(reason)


def _call_bot(bot, my_history, opp_history, side, game, guard, timeout, bot_rng,
              validator=None):
    try:
        if timeout is not None:
            from .timeout import BotTimeout, RemoteFailure, call_with_timeout
            try:
                move, rng_state = call_with_timeout(
                    _isolated_bot_call,
                    (bot, my_history, opp_history, bot_rng.getstate()),
                    timeout,
                )
                bot_rng.setstate(rng_state)
            except BotTimeout as exc:
                raise Forfeit(side, str(exc)) from exc
            except RemoteFailure as exc:
                raise Forfeit(side, f"raised {exc.type_name}: {exc}") from exc
        else:
            move = _isolated_bot(bot, bot_rng)(my_history, opp_history)
    except Forfeit:
        raise
    except Exception as exc:
        if not guard:
            raise
        raise Forfeit(side, f"raised {type(exc).__name__}: {exc}") from exc
    if guard:
        error = (validator or game.validate_action)(move)
        if error:
            raise Forfeit(side, error)
    return move


def _isolated_bot(bot, bot_rng):
    """Run a legacy module-random bot with a private stream and restore global state."""
    def call(my_history, opp_history):
        process_state = random.getstate()
        random.setstate(bot_rng.getstate())
        try:
            return bot(my_history, opp_history)
        finally:
            bot_rng.setstate(random.getstate())
            random.setstate(process_state)
    return call


def _isolated_bot_call(bot, my_history, opp_history, rng_state):
    rng = random.Random()
    rng.setstate(rng_state)
    move = _isolated_bot(bot, rng)(my_history, opp_history)
    return move, rng.getstate()


def _side_seed(seed, side):
    if seed is None:
        return None
    material = f"{seed}|bot-side|{side}".encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big")


def _forfeit_result(game, turns, side, reason, history1, history2):
    score1, score2 = game.forfeit_scores(side, turns)
    return {
        "history1": history1,
        "history2": history2,
        "score1": score1,
        "score2": score2,
        "forfeit": {"side": side, "reason": reason},
    }


def play_match(bot1, bot2, game, turns, noise=0.0, seed=None, *, guard=False,
               timeout=None, bot_random_seeds=None):
    """Play `turns` rounds of `game`.

    Bots are called as strategy(my_history, opp_history). Each argument is a
    copy of the moves actually played so far, oldest first. Noise is applied
    before a move is scored. The histories record the scored moves.

    A seed makes the match repeatable, including bots that use `random`.
    `guard=True` turns an invalid action, a crash, or a `timeout` into the
    game's forfeit score. Leave it off when the caller (the sandbox) handles
    those failures itself. A `timeout` implies `guard`.
    """
    if timeout is not None:
        guard = True
    game = get_game(game)
    if not getattr(game, "configured", True):
        raise NotImplementedError(f"{game.name} rules are pending team approval")
    if noise and game.key != "prisoners_dilemma":
        raise ValueError(f"noise is not defined for {game.name}")
    if bot_random_seeds is not None and len(bot_random_seeds) != 2:
        raise ValueError("bot_random_seeds must contain exactly two seeds")
    side_seeds = bot_random_seeds or (_side_seed(seed, 0), _side_seed(seed, 1))
    bot_rngs = (random.Random(side_seeds[0]), random.Random(side_seeds[1]))
    rng = random.Random(seed)
    history1, history2 = [], []
    state = game.new_state()

    bots = (bot1, bot2)
    for turn in range(turns):
        try:
            def call_bot(bot, side, my_history, opp_history, validator):
                return _call_bot(
                    bot,
                    copy.deepcopy(my_history),
                    copy.deepcopy(opp_history),
                    side,
                    game,
                    guard,
                    timeout,
                    bot_rngs[side],
                    validator,
                )

            move1, move2 = game.collect_actions(
                bots, (history1, history2), turn, call_bot,
            )
        except Forfeit as forfeited:
            if not guard:
                raise
            return _forfeit_result(game, turns, forfeited.side, forfeited.reason, history1, history2)

        if game.actions:
            move1 = apply_noise(move1, game.actions, noise, rng)
            move2 = apply_noise(move2, game.actions, noise, rng)
        move1, move2 = game.resolve_actions(state, move1, move2)
        game.apply(state, move1, move2)
        history1.append(move1)
        history2.append(move2)

    score1, score2 = game.totals(state)
    return {
        "history1": history1,
        "history2": history2,
        "score1": score1,
        "score2": score2,
        "forfeit": None,
    }
