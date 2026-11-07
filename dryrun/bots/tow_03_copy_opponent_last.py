"""Copies the opponent's previous region allocation."""


def strategy(my_history, opp_history):
    """Copies the prior move when available, otherwise uses even split."""
    if not opp_history:
        return [20, 20, 20, 20, 20]
    return list(opp_history[-1])
