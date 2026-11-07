"""Intentional crash bot: it behaves normally for the first 100 turns and then raises."""


def strategy(my_history, opp_history):
    """Crashes after 100 completed turns to satisfy the dry-run requirement."""
    if len(my_history) >= 100:
        raise RuntimeError("intentional crash after 100 completed turns")
    if not opp_history:
        return "C"
    return opp_history[-1]
