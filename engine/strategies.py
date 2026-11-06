"""Built-in bots for all three DEFCON Zero rounds."""

import random


# --- Round 1: Prisoner's Dilemma ("C", "D") ---

def always_cooperate(my_history, opp_history):
    """Always cooperates."""
    return "C"


def always_defect(my_history, opp_history):
    """Always defects."""
    return "D"


def random_bot(my_history, opp_history):
    """Cooperates or defects with equal probability."""
    return random.choice(["C", "D"])


def tit_for_tat(my_history, opp_history):
    """Cooperates first, then copies the opponent's last move."""
    return opp_history[-1] if opp_history else "C"


def grudger(my_history, opp_history):
    """Cooperates until the opponent defects once, then defects forever."""
    return "D" if "D" in opp_history else "C"


def tit_for_two_tats(my_history, opp_history):
    """Defects only if the opponent defected in each of the last two rounds."""
    return "D" if opp_history[-2:] == ["D", "D"] else "C"


def alternator(my_history, opp_history):
    """Alternates C, D, C, D, ... starting with C."""
    return "C" if len(my_history) % 2 == 0 else "D"


def suspicious_tit_for_tat(my_history, opp_history):
    """Defects first, then copies the opponent's last move."""
    return opp_history[-1] if opp_history else "D"


def win_stay_lose_shift(my_history, opp_history):
    """Cooperates first; repeats its move if the opponent cooperated, otherwise switches."""
    if not my_history:
        return "C"
    if opp_history[-1] == "C":
        return my_history[-1]
    return "D" if my_history[-1] == "C" else "C"


# --- Round 2: Theatre of War ("ATTACK", "DEFEND", "EXPAND") ---

def aggressive(my_history, opp_history):
    """Always attacks."""
    return "ATTACK"


def defensive(my_history, opp_history):
    """Always defends."""
    return "DEFEND"


def fortress(my_history, opp_history):
    """Defends if attacked last turn, otherwise expands."""
    if opp_history and opp_history[-1] == "ATTACK":
        return "DEFEND"
    return "EXPAND"


def opportunistic(my_history, opp_history):
    """Counters the opponent's previous move."""
    if not opp_history:
        return "EXPAND"
    last = opp_history[-1]
    if last == "EXPAND":
        return "ATTACK"
    if last == "ATTACK":
        return "DEFEND"
    return "EXPAND"


# --- Round 3: Foreign Aid ("AID", "WITHHOLD") ---

def always_aid(my_history, opp_history):
    """Always sends aid."""
    return "AID"


def never_aid(my_history, opp_history):
    """Always withholds aid."""
    return "WITHHOLD"


def tit_for_tat_aid(my_history, opp_history):
    """Aids first, then copies the opponent's last move."""
    return opp_history[-1] if opp_history else "AID"


def grudger_aid(my_history, opp_history):
    """Aids until the opponent withholds once, then withholds forever."""
    return "WITHHOLD" if "WITHHOLD" in opp_history else "AID"


BUILT_IN_BOTS = {
    "always_cooperate": always_cooperate,
    "always_defect": always_defect,
    "random_bot": random_bot,
    "tit_for_tat": tit_for_tat,
    "grudger": grudger,
    "tit_for_two_tats": tit_for_two_tats,
    "alternator": alternator,
    "suspicious_tit_for_tat": suspicious_tit_for_tat,
    "win_stay_lose_shift": win_stay_lose_shift,
    "aggressive": aggressive,
    "defensive": defensive,
    "fortress": fortress,
    "opportunistic": opportunistic,
    "always_aid": always_aid,
    "never_aid": never_aid,
    "tit_for_tat_aid": tit_for_tat_aid,
    "grudger_aid": grudger_aid,
}

BOTS_BY_GAME = {
    "prisoners_dilemma": {
        "tit_for_tat": tit_for_tat,
        "always_defect": always_defect,
        "always_cooperate": always_cooperate,
        "grudger": grudger,
    },
    "theatre_of_war": {
        "aggressive": aggressive,
        "defensive": defensive,
        "fortress": fortress,
        "opportunistic": opportunistic,
    },
    "foreign_aid": {
        "always_aid": always_aid,
        "never_aid": never_aid,
        "tit_for_tat_aid": tit_for_tat_aid,
        "grudger_aid": grudger_aid,
    },
}
