"""Gives a steady amount and responds generously to gifts."""


def strategy(my_history, opp_history):
    """Sends a modest amount and returns most of the available gift."""
    if len(opp_history) == len(my_history):
        return 6
    sent = opp_history[-1]
    if not my_history:
        return sent * 3
    previous_return = my_history[-1]
    return max(0, min(sent * 3, previous_return + 2))
