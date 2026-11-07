"""Alternate cooperation and betrayal."""


def strategy(my_history, opp_history):
    """Starts with cooperation and flips every turn."""
    return "C" if len(my_history) % 2 == 0 else "D"
