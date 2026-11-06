"""Two-player games defined by payoff tables across all three DEFCON Zero rounds."""


class Game:
    """A symmetric matrix game: payoffs maps (move1, move2) -> (score1, score2)."""

    def __init__(self, name, payoffs, *, key=None, moves=None):
        self.name = name
        self.payoffs = payoffs
        self.key = key or name.lower().replace("'", "").replace(" ", "_")
        self.moves = tuple(moves) if moves else tuple(sorted({m1 for m1, _ in payoffs}))

    def score(self, move1, move2):
        return self.payoffs[(move1, move2)]

    def __repr__(self):
        return f"Game({self.name!r})"


PRISONERS_DILEMMA = Game(
    "Prisoner's Dilemma",
    {
        ("C", "C"): (3, 3),
        ("C", "D"): (0, 5),
        ("D", "C"): (5, 0),
        ("D", "D"): (1, 1),
    },
    key="prisoners_dilemma",
    moves=("C", "D"),
)

THEATRE_OF_WAR = Game(
    "Theatre of War",
    {
        ("ATTACK", "ATTACK"): (1, 1),
        ("ATTACK", "DEFEND"): (1, 3),
        ("ATTACK", "EXPAND"): (4, 0),
        ("DEFEND", "ATTACK"): (3, 1),
        ("DEFEND", "DEFEND"): (2, 2),
        ("DEFEND", "EXPAND"): (1, 4),
        ("EXPAND", "ATTACK"): (0, 4),
        ("EXPAND", "DEFEND"): (4, 1),
        ("EXPAND", "EXPAND"): (3, 3),
    },
    key="theatre_of_war",
    moves=("ATTACK", "DEFEND", "EXPAND"),
)

FOREIGN_AID = Game(
    "Foreign Aid",
    {
        ("AID", "AID"): (3, 3),
        ("AID", "WITHHOLD"): (0, 5),
        ("WITHHOLD", "AID"): (5, 0),
        ("WITHHOLD", "WITHHOLD"): (1, 1),
    },
    key="foreign_aid",
    moves=("AID", "WITHHOLD"),
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
    moves=("C", "D"),
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
    moves=("C", "D"),
)

GAMES = {
    "prisoners_dilemma": PRISONERS_DILEMMA,
    "theatre_of_war": THEATRE_OF_WAR,
    "foreign_aid": FOREIGN_AID,
    "chicken": CHICKEN,
    "stag_hunt": STAG_HUNT,
}
