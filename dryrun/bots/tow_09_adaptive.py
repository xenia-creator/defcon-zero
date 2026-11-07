"""Uses the opponent's last spread as a template and fills toward 100."""


def strategy(my_history, opp_history):
    """Builds a valid spread based on the last opponent allocation."""
    if not opp_history:
        return [20, 20, 20, 20, 20]
    base = list(opp_history[-1])
    allocation = [max(0, value // 2) for value in base]
    while sum(allocation) < 100:
        for index in range(5):
            if sum(allocation) >= 100:
                break
            allocation[index] += 1
    return allocation
