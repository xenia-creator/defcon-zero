"""Bot registry keyed by a bot ID and game.

Some games intentionally use the same built-in ID (for example `random`).
Register new bots with `register_bot`.
"""

from .blotto_strategies import BLOTTO_BOTS
from .foreign_aid_strategies import FOREIGN_AID_BOTS
from .games import FOREIGN_AID, PRISONERS_DILEMMA, THEATRE_OF_WAR
from .strategies import BUILT_IN_BOTS


class BotRegistry:
    """Maps a bot id to its strategy function and game."""

    def __init__(self):
        self._bots = {}

    def register(self, bot_id, strategy, game):
        if not isinstance(bot_id, str) or not bot_id:
            raise ValueError("bot id must be a non-empty string")
        if not callable(strategy):
            raise TypeError("strategy must be a function")
        if not callable(getattr(game, "validate_action", None)):
            raise ValueError("game must define a move validator")
        key = (bot_id, game.key)
        if key in self._bots:
            raise ValueError(f"Bot {bot_id!r} is already registered")
        self._bots[key] = {"strategy": strategy, "game": game}
        return strategy

    def entry(self, bot_id, game=None):
        if game is not None:
            key = game if isinstance(game, str) else game.key
            try:
                return self._bots[(bot_id, key)]
            except KeyError:
                raise KeyError(f"Unknown bot {bot_id!r} for game {key!r}") from None
        matches = [entry for (name, _), entry in self._bots.items() if name == bot_id]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            known = ", ".join(sorted(name for name, _ in self._bots))
            raise KeyError(f"Unknown bot {bot_id!r}. Known bots: {known}") from None
        raise KeyError(f"Bot {bot_id!r} is registered for multiple games; specify game")

    def get(self, bot_id, game=None):
        return self.entry(bot_id, game)["strategy"]

    def game_of(self, bot_id, game=None):
        return self.entry(bot_id, game)["game"]

    def games_for(self, bot_id):
        return [
            entry["game"]
            for (name, _), entry in self._bots.items()
            if name == bot_id
        ]

    def bots_for(self, game):
        key = game if isinstance(game, str) else game.key
        return {
            bot_id: entry["strategy"]
            for (bot_id, game_key), entry in self._bots.items()
            if game_key == key
        }

    def ids(self, game=None):
        if game is None:
            return sorted({name for name, _ in self._bots})
        key = game if isinstance(game, str) else game.key
        return sorted(name for name, game_key in self._bots if game_key == key)


def _standard_registry():
    registry = BotRegistry()
    for name, strategy in BUILT_IN_BOTS.items():
        registry.register(name, strategy, PRISONERS_DILEMMA)
    for name, strategy in BLOTTO_BOTS.items():
        registry.register(name, strategy, THEATRE_OF_WAR)
    for name, strategy in FOREIGN_AID_BOTS.items():
        registry.register(name, strategy, FOREIGN_AID)
    return registry


REGISTRY = _standard_registry()


def register_bot(bot_id, strategy, game):
    """Add a bot to the shared registry. The id must be new."""
    return REGISTRY.register(bot_id, strategy, game)


def get_bot(bot_id, game=None):
    """Return the strategy function registered under `bot_id`."""
    return REGISTRY.get(bot_id, game)


def bots_for(game):
    """Return `{id: strategy}` for every bot registered for `game`."""
    return REGISTRY.bots_for(game)


def play_registered(name1, name2, turns, noise=None, seed=None, *, game=None, **kwargs):
    """Play two registered bots. They must belong to the same game."""
    if game is None:
        games1 = {item.key: item for item in REGISTRY.games_for(name1)}
        games2 = {item.key: item for item in REGISTRY.games_for(name2)}
        shared_games = sorted(games1.keys() & games2.keys())
        if len(shared_games) > 1:
            raise ValueError(
                f"Bot IDs {name1!r} and {name2!r} share multiple games; specify game"
            )
        if shared_games:
            game1 = game2 = games1[shared_games[0]]
        elif games1 and games2:
            game1 = next(iter(games1.values()))
            game2 = next(iter(games2.values()))
        else:
            game1 = REGISTRY.game_of(name1)
            game2 = REGISTRY.game_of(name2)
    else:
        game1 = game2 = game
    game1 = REGISTRY.game_of(name1, game1)
    game2 = REGISTRY.game_of(name2, game2)
    if game1.key != game2.key:
        raise ValueError(f"{name1} plays {game1.name}, but {name2} plays {game2.name}")
    from .match import play_match
    return play_match(
        get_bot(name1, game1), get_bot(name2, game2), game1, turns,
        noise=noise, seed=seed, **kwargs,
    )
