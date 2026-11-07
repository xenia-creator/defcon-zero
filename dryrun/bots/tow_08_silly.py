"""A goofy but valid allocation pattern."""


def strategy(my_history, opp_history):
    """Alternates a silly but legal troop split."""
    if not my_history:
        return [20, 20, 20, 20, 20]
    return [10, 30, 15, 30, 15] if len(my_history) % 2 == 0 else [15, 30, 15, 25, 15]
