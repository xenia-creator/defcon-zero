"""Intentional crash bot: valid allocations through turn 100, then it raises."""


def strategy(my_history, opp_history):
    """Crashes after 100 completed turns to satisfy the dry-run requirement."""
    if len(my_history) >= 100:
        raise RuntimeError("intentional crash after 100 completed turns")
    return [20, 20, 20, 20, 20]
