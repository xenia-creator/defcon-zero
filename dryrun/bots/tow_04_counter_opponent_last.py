"""Adds one troop to the opponent's weakest regions and removes from the strongest."""


def strategy(my_history, opp_history):
    """Imitates the engine's counter strategy without mutating history."""
    if not opp_history:
        return [20, 20, 20, 20, 20]
    opponent = list(opp_history[-1])
    weakest = sorted(range(5), key=lambda idx: (opponent[idx], idx))[:3]
    allocation = opponent.copy()
    for idx in weakest:
        allocation[idx] += 1
    remaining = [idx for idx in range(5) if idx not in weakest]
    for idx in sorted(remaining, key=lambda item: (-allocation[item], item)):
        removed = min(allocation[idx], sum(allocation) - 100)
        allocation[idx] -= removed
        if sum(allocation) == 100:
            break
    return allocation
