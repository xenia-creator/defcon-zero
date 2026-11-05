"""Play a single repeated match between two bots."""

import random

from .noise import apply_noise


class Forfeit(Exception):
    """A bot crashed, timed out, or returned an action this game does not use."""

    def __init__(self, side, reason):
        self.side = side
        self.reason = reason
        super().__init__(reason)


def _call_bot(bot, my_history, opp_history, side, game, guard, timeout):
    try:
        if timeout is not None:
            from .timeout import BotTimeout, RemoteFailure, call_with_timeout
            try:
                move = call_with_timeout(bot, (my_history, opp_history), timeout)
            except BotTimeout as exc:
                raise Forfeit(side, str(exc)) from exc
            except RemoteFailure as exc:
                raise Forfeit(side, f"raised {exc.type_name}: {exc}") from exc
        else:
            move = bot(my_history, opp_history)
    except Forfeit:
        raise
    except Exception as exc:
        if not guard:
            raise
        raise Forfeit(side, f"raised {type(exc).__name__}: {exc}") from exc
    if guard and move not in game.actions:
        allowed = ", ".join(repr(action) for action in game.actions)
        raise Forfeit(side, f"returned {move!r} instead of one of {allowed}")
    return move


def _forfeit_result(game, turns, side, reason, history1, history2):
    score1, score2 = game.forfeit_scores(side, turns)
    return {
        "history1": history1,
        "history2": history2,
        "score1": score1,
        "score2": score2,
        "forfeit": {"side": side, "reason": reason},
    }


def play_match(bot1, bot2, game, turns, noise=0.0, seed=None, *, guard=False, timeout=None):
    """Play `turns` rounds of `game`.

    Bots are called as strategy(my_history, opp_history). Each argument is a
    copy of the moves actually played so far, oldest first. Noise is applied
    before a move is scored, and Foreign Aid then turns an unaffordable AID
    into WITHHOLD. The histories record that scored move.

    A seed makes the match repeatable, including bots that use `random`.
    `guard=True` turns an invalid action, a crash, or a `timeout` into the
    game's forfeit score. Leave it off when the caller (the sandbox) handles
    those failures itself. A `timeout` implies `guard`.
    """
    if timeout is not None:
        guard = True
    if seed is not None:
        random.seed(seed)  # seeds the global RNG that bots like random_bot use
    rng = random.Random(seed)
    history1, history2 = [], []
    state = game.new_state()

    for _ in range(turns):
        try:
            # Pass copies so a bot can't tamper with the real histories
            move1 = _call_bot(bot1, list(history1), list(history2), 0, game, guard, timeout)
            move2 = _call_bot(bot2, list(history2), list(history1), 1, game, guard, timeout)
        except Forfeit as forfeited:
            if not guard:
                raise
            return _forfeit_result(game, turns, forfeited.side, forfeited.reason, history1, history2)

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
