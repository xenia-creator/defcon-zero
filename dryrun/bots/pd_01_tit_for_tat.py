"""Cooperate first, then mirror the opponent's last move."""


def strategy(my_history, opp_history):
    """Cooperates first, then mirrors the opponent's last move."""
    if not opp_history:
        return "C"
    return opp_history[-1]
