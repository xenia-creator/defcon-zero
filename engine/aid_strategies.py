"""Foreign Aid bots. Each takes (my_history, opp_history)."""

import random


def always_aid(my_history, opp_history):
    """Always gives aid."""
    return "AID"


def never_aid(my_history, opp_history):
    """Never gives aid."""
    return "WITHHOLD"


def random_aid(my_history, opp_history):
    """Gives aid or withholds with equal probability."""
    return random.choice(("AID", "WITHHOLD"))


def tit_for_tat_aid(my_history, opp_history):
    """Gives aid first, then copies the opponent's last move."""
    return opp_history[-1] if opp_history else "AID"


def reciprocity(my_history, opp_history):
    """Gives aid with probability equal to the opponent's overall aid rate."""
    if not opp_history:
        return "AID"
    rate = opp_history.count("AID") / len(opp_history)
    return "AID" if random.random() < rate else "WITHHOLD"


def grudger_aid(my_history, opp_history):
    """Gives aid until the opponent withholds once, then withholds forever."""
    return "WITHHOLD" if "WITHHOLD" in opp_history else "AID"


def majority_aid(my_history, opp_history):
    """Plays the opponent's most common move. A tie, including no history, is AID."""
    if opp_history.count("WITHHOLD") > opp_history.count("AID"):
        return "WITHHOLD"
    return "AID"


def adaptive_aid(my_history, opp_history):
    """Gives aid when at least half of the opponent's last five moves were aid."""
    if not opp_history:
        return "AID"
    window = opp_history[-5:]
    return "AID" if window.count("AID") * 2 >= len(window) else "WITHHOLD"


AID_BOTS = {
    "always_aid": always_aid,
    "never_aid": never_aid,
    "random_aid": random_aid,
    "tit_for_tat_aid": tit_for_tat_aid,
    "reciprocity": reciprocity,
    "grudger_aid": grudger_aid,
    "majority_aid": majority_aid,
    "adaptive_aid": adaptive_aid,
}
