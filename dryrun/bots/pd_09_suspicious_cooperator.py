"""A mild variant that punishes repeated betrayal and otherwise stays generous."""


def strategy(my_history, opp_history):
    """Acts cooperatively unless the opponent's last move was a betrayal."""
    if not opp_history:
        return "C"
    if opp_history[-1] == "D":
        return "D"
    return "C" if len(my_history) % 3 else "D"
