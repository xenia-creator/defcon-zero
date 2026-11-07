"""Repeat the last action after a cooperative opponent, otherwise switch."""


def strategy(my_history, opp_history):
    """Uses a simple win-stay, lose-shift policy."""
    if not my_history:
        return "C"
    if opp_history[-1] == "C":
        return my_history[-1]
    return "D" if my_history[-1] == "C" else "C"
