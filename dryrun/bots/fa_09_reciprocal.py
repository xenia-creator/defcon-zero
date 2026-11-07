"""Responds to the opponent's last move in a straightforward way."""


def strategy(my_history, opp_history):
    """Returns roughly what it received and mirrors the last send."""
    if len(opp_history) == len(my_history):
        if not opp_history:
            return 5
        return max(0, min(10, opp_history[-1]))
    sent = opp_history[-1]
    if not my_history:
        return 0
    return max(0, min(sent * 3, my_history[-1]))
