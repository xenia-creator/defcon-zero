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
        for move in (move1, move2):
            error = self.validate_action(move)
            if error:
                raise ValueError(error)
        return self.payoffs[(move1, move2)]

    def validate_action(self, move):
        if any(move == action for action in self.actions):
            return None
        allowed = ", ".join(repr(action) for action in self.actions)
        return f"Invalid {self.name} move {move!r}; expected one of: {allowed}"

    def collect_actions(self, bots, histories, turn, call_bot):
        """Collect simultaneous actions in player order."""
        return (
            call_bot(bots[0], 0, histories[0], histories[1], self.validate_action),
            call_bot(bots[1], 1, histories[1], histories[0], self.validate_action),
        )

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


class TheatreOfWarGame(Game):
    """Five-region allocation game with 100 troops."""

    troop_count = 100
    front_count = 5
    configured = True

    def __init__(self):
        super().__init__(
            "Theatre of War", None, key="theatre_of_war", actions=(),
            forfeit_formula=_credit(3), round_number=2,
        )

    def validate_action(self, move):
        if not isinstance(move, list):
            return "Invalid Theatre of War allocation; expected a list of five integers"
        if len(move) != self.front_count:
            return f"Invalid Theatre of War allocation; expected 5 regions, got {len(move)}"
        if any(not isinstance(troops, int) or isinstance(troops, bool) for troops in move):
            return "Invalid Theatre of War allocation; every region must have a whole-number troop count"
        if any(troops < 0 for troops in move):
            return "Invalid Theatre of War allocation; troop counts cannot be negative"
        if sum(move) != self.troop_count:
            return f"Invalid Theatre of War allocation; troop counts must sum to 100, got {sum(move)}"
        return None

    def score(self, move1, move2):
        for move in (move1, move2):
            error = self.validate_action(move)
            if error:
                raise ValueError(error)
        regions1 = regions2 = 0.0
        for troops1, troops2 in zip(move1, move2):
            if troops1 > troops2:
                regions1 += 1
            elif troops2 > troops1:
                regions2 += 1
            else:
                regions1 += 0.5
                regions2 += 0.5
        if regions1 > regions2:
            return 1, 0
        if regions2 > regions1:
            return 0, 1
        return 0.5, 0.5


class ForeignAidGame(Game):
    """Alternating sender/receiver game with sequential actions per turn."""

    def __init__(self):
        super().__init__(
            "Foreign Aid", None, key="foreign_aid", actions=(),
            forfeit_formula=_credit(3), round_number=3,
        )

    def validate_action(self, move, *, role="sender", sent=None):
        if not isinstance(move, int) or isinstance(move, bool):
            return "Invalid Foreign Aid action; expected a whole number"
        if role == "sender":
            if not 0 <= move <= 10:
                return "Invalid Foreign Aid send; expected a whole number from 0 to 10"
            return None
        if role == "receiver":
            if sent is None:
                raise ValueError("sent is required to validate a receiver return")
            if not 0 <= move <= sent * 3:
                return f"Invalid Foreign Aid return; expected a whole number from 0 to {sent * 3}"
            return None
        raise ValueError(f"Unknown Foreign Aid role: {role!r}")

    def collect_actions(self, bots, histories, turn, call_bot):
        sender = turn % 2
        receiver = 1 - sender
        sent = call_bot(
            bots[sender],
            sender,
            histories[sender],
            histories[receiver],
            self.validate_action,
        )
        receiver_opponent_history = [*histories[sender], sent]
        returned = call_bot(
            bots[receiver],
            receiver,
            histories[receiver],
            receiver_opponent_history,
            lambda move: self.validate_action(move, role="receiver", sent=sent),
        )
        actions = [None, None]
        actions[sender] = sent
        actions[receiver] = returned
        return tuple(actions)

    def score(self, sent, returned):
        error = self.validate_action(sent, role="sender")
        if error:
            raise ValueError(error)
        error = self.validate_action(returned, role="receiver", sent=sent)
        if error:
            raise ValueError(error)
        tripled = sent * 3
        return 10 - sent + returned, tripled - returned

    def new_state(self):
        return {"score1": 0, "score2": 0, "turn": 0}

    def apply(self, state, move1, move2):
        sender = state["turn"] % 2
        sent, returned = (move1, move2) if sender == 0 else (move2, move1)
        sender_score, receiver_score = self.score(sent, returned)
        scores = [0, 0]
        scores[sender] = sender_score
        scores[1 - sender] = receiver_score
        state["score1"] += scores[0]
        state["score2"] += scores[1]
        state["turn"] += 1


PRISONERS_DILEMMA = Game(
    "Prisoner's Dilemma",
    {
        ("C", "C"): (3, 3),
        ("C", "D"): (0, 5),
        ("D", "C"): (5, 0),
        ("D", "D"): (1, 1),
    },
    key="prisoners_dilemma",
    actions=("C", "D"),
    forfeit_formula=_credit(3),
    round_number=1,
)

THEATRE_OF_WAR = TheatreOfWarGame()
FOREIGN_AID = ForeignAidGame()

# Compatibility aliases for callers using the earlier internal constant names.
BLOTTO = THEATRE_OF_WAR
TRUST = FOREIGN_AID

GAMES = {
    PRISONERS_DILEMMA.key: PRISONERS_DILEMMA,
    THEATRE_OF_WAR.key: THEATRE_OF_WAR,
    FOREIGN_AID.key: FOREIGN_AID,
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
