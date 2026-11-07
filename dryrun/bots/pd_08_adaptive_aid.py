"""Cooperate when the opponent has been mostly cooperative recently."""


def strategy(my_history, opp_history):
    """Looks at the opponent's recent actions and adapts."""
    if not opp_history:
        return "C"
    recent = opp_history[-5:]
    return "C" if recent.count("C") * 2 >= len(recent) else "D"
