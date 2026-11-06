"""Built-in Foreign Aid strategies."""

import random as _random


def _is_receiver(my_history, opp_history):
    return len(opp_history) > len(my_history)


def always_send_10_return_half(my_history, opp_history):
    if not _is_receiver(my_history, opp_history):
        return 10
    return opp_history[-1] * 3 // 2


def always_send_0_return_0(my_history, opp_history):
    return 0


def tit_for_tat(my_history, opp_history):
    if not _is_receiver(my_history, opp_history):
        return min(10, max(0, opp_history[-1] if opp_history else 0))
    available = opp_history[-1] * 3
    previous_return = my_history[-2] if len(my_history) >= 2 else 0
    return min(available, max(0, previous_return))


def random(my_history, opp_history):
    if not _is_receiver(my_history, opp_history):
        return _random.randint(0, 10)
    return _random.randint(0, opp_history[-1] * 3)


FOREIGN_AID_BOTS = {
    "always_send_10_return_half": always_send_10_return_half,
    "always_send_0_return_0": always_send_0_return_0,
    "tit_for_tat": tit_for_tat,
    "random": random,
}
