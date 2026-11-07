"""Cooperate until the opponent defects once, then defect forever."""


def strategy(my_history, opp_history):
    """Defects forever after the first betrayal it observes."""
    return "D" if "D" in opp_history else "C"
