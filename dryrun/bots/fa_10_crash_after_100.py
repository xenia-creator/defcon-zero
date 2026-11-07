"""Intentional crash bot: valid decisions through 100 turns, then it raises."""


def strategy(my_history, opp_history):
    """Crashes after 100 completed turns to satisfy the dry-run requirement."""
    if len(my_history) >= 100:
        raise RuntimeError("intentional crash after 100 completed turns")
    if len(opp_history) == len(my_history):
        return 5
    return 0
