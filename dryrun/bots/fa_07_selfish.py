"""Always asks for aid but never gives much back."""


def strategy(my_history, opp_history):
    """Sends 10 when acting as sender, then returns only a small fraction."""
    if len(opp_history) == len(my_history):
        return 10
    sent = opp_history[-1]
    return max(0, min(sent * 3, sent))
