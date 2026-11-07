"""Cycles a steady pattern of allocations across all regions."""


def strategy(my_history, opp_history):
    """Uses a repeating pattern that always totals 100."""
    pattern = [15, 25, 30, 20, 10]
    if not my_history:
        return pattern
    shift = len(my_history) % 5
    return pattern[shift:] + pattern[:shift]
