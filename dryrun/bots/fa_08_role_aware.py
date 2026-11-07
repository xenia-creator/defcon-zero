"""Changes behavior based on whether it is sending or receiving."""


def strategy(my_history, opp_history):
    """Uses the role to maintain a simple but valid response pattern."""
    if len(opp_history) == len(my_history):
        if not opp_history:
            return 4
        return max(0, min(10, opp_history[-1] - 1))
    sent = opp_history[-1]
    if not my_history:
        return 0
    return max(0, min(sent * 3, my_history[-1] // 2 + 1))
