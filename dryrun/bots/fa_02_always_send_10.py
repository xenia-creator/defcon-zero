"""Generous strategy that always sends 10 and returns most of the gift."""


def strategy(my_history, opp_history):
    """Sends a full gift and returns the full available amount when receiving."""
    if len(opp_history) == len(my_history):
        return 10
    sent = opp_history[-1]
    return sent * 3
