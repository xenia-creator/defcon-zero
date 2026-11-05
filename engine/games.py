"""Game rules: action sets, payoffs, resources and forfeit credit.

Rounds 2 and 3 use the numbers in docs/rules.md. Those numbers are still
marked proposed there and still need team approval.
"""


def _credit(per_turn):
    return lambda turns: per_turn * turns


class Game:
    """A two-player game.

    Matrix games score each turn from `payoffs` and add those points up.
    `score(move1, move2)` is that turn's (row, column) result.
    """

    def __init__(self, name, payoffs, *, key, actions, forfeit_formula,
                 round_number=None, turns=None):
        self.name = name
        self.key = key
        self.payoffs = payoffs
        self.actions = tuple(actions)
        self.round_number = round_number
        self.turns = turns
        self._forfeit_formula = forfeit_formula

    def score(self, move1, move2):
        return self.payoffs[(move1, move2)]

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


class ForeignAidGame(Game):
    """Foreign Aid. The match score is each player's final resources.

    Starting resources, the aid cost and the receiver's benefit are the
    proposed Round 3 rules. A player who chooses AID with fewer resources
    than the cost at the start of the turn plays WITHHOLD instead.
    """

    def __init__(self, name, payoffs, *, starting, cost, benefit, **kwargs):
        self.starting = starting
        self.cost = cost
        self.benefit = benefit
        super().__init__(name, payoffs, **kwargs)

    def new_state(self):
        return {
            "resources": [self.starting, self.starting],
            "score1": self.starting,
            "score2": self.starting,
        }

    def resolve_actions(self, state, move1, move2):
        resources = state["resources"]
        return (
            self._affordable(move1, resources[0]),
            self._affordable(move2, resources[1]),
        )

    def _affordable(self, move, resources):
        if move == "AID" and resources < self.cost:
            return "WITHHOLD"
        return move

    def apply(self, state, move1, move2):
        # my resources = my resources - cost * g_me + benefit * g_opponent
        resources = state["resources"]
        gave1 = 1 if move1 == "AID" else 0
        gave2 = 1 if move2 == "AID" else 0
        updated = [
            max(0, resources[0] - self.cost * gave1 + self.benefit * gave2),
            max(0, resources[1] - self.cost * gave2 + self.benefit * gave1),
        ]
        state["resources"] = updated
        state["score1"], state["score2"] = updated


def _foreign_aid_payoffs(cost, benefit):
    return {
        ("AID", "AID"): (benefit - cost, benefit - cost),
        ("AID", "WITHHOLD"): (-cost, benefit),
        ("WITHHOLD", "AID"): (benefit, -cost),
        ("WITHHOLD", "WITHHOLD"): (0, 0),
    }


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

CHICKEN = Game(
    "Chicken",
    {
        ("C", "C"): (3, 3),
        ("C", "D"): (1, 5),
        ("D", "C"): (5, 1),
        ("D", "D"): (0, 0),
    },
    key="chicken",
    actions=("C", "D"),
    # The sandbox still pays 3 per turn for every game it runs.
    forfeit_formula=_credit(3),
)

STAG_HUNT = Game(
    "Stag Hunt",
    {
        ("C", "C"): (4, 4),
        ("C", "D"): (0, 3),
        ("D", "C"): (3, 0),
        ("D", "D"): (2, 2),
    },
    key="stag_hunt",
    actions=("C", "D"),
    forfeit_formula=_credit(3),
)

THEATRE_OF_WAR = Game(
    "Theatre of War",
    {
        ("ATTACK", "ATTACK"): (1, 1),
        ("ATTACK", "DEFEND"): (0, 2),
        ("ATTACK", "EXPAND"): (5, 0),
        ("DEFEND", "ATTACK"): (2, 0),
        ("DEFEND", "DEFEND"): (2, 2),
        ("DEFEND", "EXPAND"): (1, 4),
        ("EXPAND", "ATTACK"): (0, 5),
        ("EXPAND", "DEFEND"): (4, 1),
        ("EXPAND", "EXPAND"): (3, 3),
    },
    key="theatre_of_war",
    actions=("ATTACK", "DEFEND", "EXPAND"),
    forfeit_formula=_credit(3),
    round_number=2,
    turns=200,
)

_AID_START = 10
_AID_COST = 1
_AID_BENEFIT = 3

FOREIGN_AID = ForeignAidGame(
    "Foreign Aid",
    _foreign_aid_payoffs(_AID_COST, _AID_BENEFIT),
    key="foreign_aid",
    actions=("AID", "WITHHOLD"),
    forfeit_formula=lambda turns: _AID_START + (_AID_BENEFIT - _AID_COST) * turns,
    round_number=3,
    turns=200,
    starting=_AID_START,
    cost=_AID_COST,
    benefit=_AID_BENEFIT,
)

GAMES = {
    PRISONERS_DILEMMA.key: PRISONERS_DILEMMA,
    THEATRE_OF_WAR.key: THEATRE_OF_WAR,
    FOREIGN_AID.key: FOREIGN_AID,
    CHICKEN.key: CHICKEN,
    STAG_HUNT.key: STAG_HUNT,
}
