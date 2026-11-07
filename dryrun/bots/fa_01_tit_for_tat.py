"""Cooperate first, then mirror the opponent's last send or return."""


def strategy(my_history, opp_history):
    """Shares fairly while tracking prior roles and returns."""
    if len(opp_history) == len(my_history):
        if not opp_history:
            return 10
        return min(10, max(0, opp_history[-1]))
    sent = opp_history[-1]
    if not my_history:
        return 0
    return max(0, min(sent * 3, my_history[-1]))
