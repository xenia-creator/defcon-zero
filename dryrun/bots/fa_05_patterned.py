"""Alternates a simple aid pattern while staying in bounds."""


def strategy(my_history, opp_history):
    """Sends 10 on even turns and 0 on odd ones, returning half of what it gets."""
    if len(opp_history) == len(my_history):
        return 10 if len(my_history) % 2 == 0 else 0
    sent = opp_history[-1]
    return sent * 3 // 2
