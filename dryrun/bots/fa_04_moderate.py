"""A moderate, predictable aid policy."""


def strategy(my_history, opp_history):
    """Sends a moderate amount and returns a proportion of the gift."""
    if len(opp_history) == len(my_history):
        return 5
    sent = opp_history[-1]
    return max(0, min(sent * 3, sent * 2))
