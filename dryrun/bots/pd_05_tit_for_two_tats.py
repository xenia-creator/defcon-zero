"""Defect only after two consecutive opponent defects."""


def strategy(my_history, opp_history):
    """Punishes sustained defection but stays forgiving otherwise."""
    if len(opp_history) >= 2 and opp_history[-2:] == ["D", "D"]:
        return "D"
    return "C"
