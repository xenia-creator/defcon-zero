# Source: frontend/src/workspace/blocks/examples.ts (foreign_aid: Break Even).
ENDOWMENT = 10  # the most you can send (config.endowment)
MULTIPLIER = 3  # what you send arrives multiplied by this (config.multiplier)


def legal_send(amount):
    """Any amount becomes a legal send: a whole number from 0 to ENDOWMENT."""
    return max(0, min(ENDOWMENT, int(amount)))


def legal_return(amount, received):
    """Any amount becomes a legal send-back: a whole number from 0 to what you received."""
    return max(0, min(received, int(amount)))


def split_history(my_history, opp_history):
    """Each turn one side sends and the other sends back, so both histories mix the two.
    This sorts them into what each side sent and sent back, oldest first.
    my_sent[i] goes with opp_returned[i], and opp_sent[i] with my_returned[i]."""
    start = len(opp_history) % 2   # where my sends sit in my history
    my_sent = my_history[start::2]
    my_returned = my_history[1 - start::2]
    opp_sent = opp_history[1 - start::2]
    opp_returned = opp_history[start::2]
    return my_sent, my_returned, opp_sent, opp_returned


def strategy(my_history, opp_history):
    my_sent, my_returned, opp_sent, opp_returned = split_history(my_history, opp_history)
    if len(opp_history) == len(my_history):
        # When I'm sending
        # If nothing above decided
        return legal_send(5)
    # When I'm receiving: the opponent just sent opp_history[-1]
    received = MULTIPLIER * opp_history[-1]
    return legal_return((opp_sent[-1] if opp_sent else 0), received)
