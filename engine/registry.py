"""Bot registry.

Every bot has one id and one game. Round 1 ids stay in `BUILT_IN_BOTS` so the
sandbox can keep loading them by name. Register new bots with `register_bot`.
"""

from .aid_strategies import AID_BOTS
from .games import FOREIGN_AID, PRISONERS_DILEMMA, THEATRE_OF_WAR
from .strategies import BUILT_IN_BOTS
from .war_strategies import WAR_BOTS


class BotRegistry:
    """Maps a bot id to its strategy function and game."""

    def __init__(self):
        self._bots = {}

    def register(self, bot_id, strategy, game):
        if not isinstance(bot_id, str) or not bot_id:
            raise ValueError("bot id must be a non-empty string")
        if not callable(strategy):
            raise TypeError("strategy must be a function")
        if not getattr(game, "actions", None):
            raise ValueError("game must define its actions")
        if bot_id in self._bots:
            raise ValueError(f"Bot {bot_id!r} is already registered")
        self._bots[bot_id] = {"strategy": strategy, "game": game}
        return strategy

    def entry(self, bot_id):
        try:
            return self._bots[bot_id]
        except KeyError:
            known = ", ".join(sorted(self._bots))
            raise KeyError(f"Unknown bot {bot_id!r}. Known bots: {known}") from None

    def get(self, bot_id):
        return self.entry(bot_id)["strategy"]

    def game_of(self, bot_id):
        return self.entry(bot_id)["game"]

    def bots_for(self, game):
        key = game if isinstance(game, str) else game.key
        return {
            bot_id: entry["strategy"]
            for bot_id, entry in self._bots.items()
            if entry["game"].key == key
        }

    def ids(self):
        return list(self._bots)


def _standard_registry():
    registry = BotRegistry()
    for name, strategy in BUILT_IN_BOTS.items():
        registry.register(name, strategy, PRISONERS_DILEMMA)
    for name, strategy in WAR_BOTS.items():
        registry.register(name, strategy, THEATRE_OF_WAR)
    for name, strategy in AID_BOTS.items():
        registry.register(name, strategy, FOREIGN_AID)
    return registry


REGISTRY = _standard_registry()


def register_bot(bot_id, strategy, game):
    """Add a bot to the shared registry. The id must be new."""
    return REGISTRY.register(bot_id, strategy, game)


def get_bot(bot_id):
    """Return the strategy function registered under `bot_id`."""
    return REGISTRY.get(bot_id)


def bots_for(game):
    """Return `{id: strategy}` for every bot registered for `game`."""
    return REGISTRY.bots_for(game)


def play_registered(name1, name2, turns, noise=0.0, seed=None, **kwargs):
    """Play two registered bots. They must belong to the same game."""
    game1 = REGISTRY.game_of(name1)
    game2 = REGISTRY.game_of(name2)
    if game1.key != game2.key:
        raise ValueError(f"{name1} plays {game1.name}, but {name2} plays {game2.name}")
    from .match import play_match
    return play_match(
        get_bot(name1), get_bot(name2), game1, turns,
        noise=noise, seed=seed, **kwargs,
    )
