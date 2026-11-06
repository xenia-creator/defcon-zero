"""Game definitions for the approved DEFCON ZERO game keys."""

from dataclasses import dataclass


@dataclass(frozen=True)
class _LinearCredit:
    per_turn: int

    def __call__(self, turns):
        return self.per_turn * turns


def _credit(per_turn):
    return _LinearCredit(per_turn)


class Game:
    """A two-player game.

    Matrix games score each turn from `payoffs` and add those points up.
    `score(move1, move2)` is that turn's (row, column) result.
    """

    def __init__(self, name, payoffs, *, key, actions, forfeit_formula,
                 round_number=None, turns=None):
        self.configured = True
        self.name = name
        self.key = key
        self.payoffs = payoffs
        self.actions = tuple(actions)
        self.round_number = round_number
        self.turns = turns
        self._forfeit_formula = forfeit_formula

    def score(self, move1, move2):
        return self.payoffs[(move1, move2)]

    def validate_action(self, move):
        if any(move == action for action in self.actions):
            return None
        allowed = ", ".join(repr(action) for action in self.actions)
        return f"Invalid {self.name} move {move!r}; expected one of: {allowed}"

    def forfeit_credit(self, turns):
        """Points the opponent receives when this bot forfeits the match."""
        return self._forfeit_formula(turns)

    def forfeit_scores(self, side, turns):
        """`(score1, score2)` when `side` (0 or 1) forfeits."""
        credit = self.forfeit_credit(turns)
        if side == 0:
            return 0, credit
        if side == 1:
            return credit, 0
        raise ValueError(f"side must be 0 or 1, not {side!r}")

    def new_state(self):
        return {"score1": 0, "score2": 0}

    def resolve_actions(self, state, move1, move2):
        """Actions that are actually scored. Matrix games score the chosen moves."""
        return move1, move2

    def apply(self, state, move1, move2):
        score1, score2 = self.score(move1, move2)
        state["score1"] += score1
        state["score2"] += score2

    def totals(self, state):
        return state["score1"], state["score2"]

    def __repr__(self):
        return f"Game({self.name!r})"


class BlottoGame(Game):
    """Colonel Blotto with ten troops and four simultaneous fronts."""

    troop_count = 10
    front_count = 4
    configured = True

    def __init__(self):
        super().__init__(
            "Colonel Blotto", None, key="blotto", actions=(),
            forfeit_formula=_credit(3), round_number=2,
        )

    def validate_action(self, move):
        if not isinstance(move, list):
            return "Invalid Colonel Blotto allocation; expected a list of four integers"
        if len(move) != self.front_count:
            return f"Invalid Colonel Blotto allocation; expected 4 fronts, got {len(move)}"
        if any(not isinstance(troops, int) or isinstance(troops, bool) for troops in move):
            return "Invalid Colonel Blotto allocation; every front must have an integer troop count"
        if any(troops < 0 for troops in move):
            return "Invalid Colonel Blotto allocation; troop counts cannot be negative"
        if sum(move) != self.troop_count:
            return f"Invalid Colonel Blotto allocation; troop counts must sum to 10, got {sum(move)}"
        return None

    def score(self, move1, move2):
        for move in (move1, move2):
            error = self.validate_action(move)
            if error:
                raise ValueError(error)
        score1 = score2 = 0.0
        for troops1, troops2 in zip(move1, move2):
            if troops1 > troops2:
                score1 += 1
            elif troops2 > troops1:
                score2 += 1
            else:
                score1 += 0.5
                score2 += 0.5
        return score1, score2


class UnconfiguredTrustGame:
    """Trust game key placeholder until its approved rules are available."""

    name = "Trust"
    key = "trust"
    actions = ()
    configured = False
    round_number = 3

    @staticmethod
    def _blocked():
        raise NotImplementedError(
            "Trust game rules are pending team approval; scoring and move validation are unavailable"
        )

    def validate_action(self, move):
        self._blocked()

    def score(self, move1, move2):
        self._blocked()

    def forfeit_credit(self, turns):
        self._blocked()

    def forfeit_scores(self, side, turns):
        self._blocked()


PRISONERS_DILEMMA = Game(
    "Prisoner's Dilemma",
    {
        ("AID", "AID"): (3, 3),
        ("AID", "WITHHOLD"): (0, 5),
        ("WITHHOLD", "AID"): (5, 0),
        ("WITHHOLD", "WITHHOLD"): (1, 1),
    },
    key="prisoners_dilemma",
    actions=("AID", "WITHHOLD"),
    forfeit_formula=_credit(3),
    round_number=1,
)

BLOTTO = BlottoGame()
TRUST = UnconfiguredTrustGame()

GAMES = {
    PRISONERS_DILEMMA.key: PRISONERS_DILEMMA,
    BLOTTO.key: BLOTTO,
    TRUST.key: TRUST,
}


def get_game(key):
    """Resolve one canonical game instance from a key or verify an instance."""
    if isinstance(key, str):
        try:
            return GAMES[key]
        except KeyError:
            raise ValueError(f"Unknown game key: {key}") from None
    game_key = getattr(key, "key", None)
    if game_key not in GAMES:
        raise TypeError(f"Expected a game key or configured game instance, got {key!r}")
    registered = GAMES[game_key]
    if type(key) is not type(registered):
        raise TypeError(f"Game instance for {game_key!r} is not the registered game type")
    return registered
