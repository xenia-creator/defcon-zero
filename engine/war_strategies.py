"""Theatre of War bots. Each takes (my_history, opp_history)."""

import random

ACTIONS = ("ATTACK", "DEFEND", "EXPAND")


def aggressive(my_history, opp_history):
    """Always attacks."""
    return "ATTACK"


def defensive(my_history, opp_history):
    """Always defends."""
    return "DEFEND"


def random_war(my_history, opp_history):
    """Picks ATTACK, DEFEND or EXPAND with equal probability."""
    return random.choice(ACTIONS)


def expansionist(my_history, opp_history):
    """Attacks after an opponent attack. Otherwise expands."""
    if opp_history and opp_history[-1] == "ATTACK":
        return "ATTACK"
    return "EXPAND"


def fortress(my_history, opp_history):
    """Defends, and attacks while the opponent's last three moves were all attacks."""
    if opp_history[-3:] == ["ATTACK", "ATTACK", "ATTACK"]:
        return "ATTACK"
    return "DEFEND"


def balanced(my_history, opp_history):
    """Plays ATTACK, DEFEND, EXPAND, then repeats. Turn 0 is ATTACK."""
    return ACTIONS[len(my_history) % 3]


def opportunistic(my_history, opp_history):
    """Attacks an expander, expands against a defender, defends against an attack."""
    if not opp_history:
        return "EXPAND"
    return {
        "EXPAND": "ATTACK",
        "DEFEND": "EXPAND",
        "ATTACK": "DEFEND",
    }[opp_history[-1]]


WAR_BOTS = {
    "aggressive": aggressive,
    "defensive": defensive,
    "random_war": random_war,
    "expansionist": expansionist,
    "fortress": fortress,
    "balanced": balanced,
    "opportunistic": opportunistic,
}
