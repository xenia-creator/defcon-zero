"""Built-in Theatre of War allocation strategies."""

import random as _random

EVEN_SPLIT = [20, 20, 20, 20, 20]


def even_split(my_history, opp_history):
    return list(EVEN_SPLIT)


def all_in(my_history, opp_history):
    return [100, 0, 0, 0, 0]


def random(my_history, opp_history):
    cuts = sorted(_random.sample(range(101), 4))
    points = (0, *cuts, 100)
    return [points[i + 1] - points[i] for i in range(5)]


def copy_opponent_last(my_history, opp_history):
    return list(opp_history[-1]) if opp_history else list(EVEN_SPLIT)


def counter_opponent_last(my_history, opp_history):
    if not opp_history:
        return list(EVEN_SPLIT)

    opponent = list(opp_history[-1])
    weakest = sorted(range(5), key=lambda index: (opponent[index], index))[:3]
    allocation = opponent.copy()
    for index in weakest:
        allocation[index] += 1

    remaining = [index for index in range(5) if index not in weakest]
    # The two unchallenged regions contain at least 40 troops in total. Remove
    # the three added troops from the larger first, with index as a stable tie-break.
    for index in sorted(remaining, key=lambda item: (-allocation[item], item)):
        removed = min(allocation[index], sum(allocation) - 100)
        allocation[index] -= removed
        if sum(allocation) == 100:
            break
    return allocation


BLOTTO_BOTS = {
    "even_split": even_split,
    "all_in": all_in,
    "random": random,
    "copy_opponent_last": copy_opponent_last,
    "counter_opponent_last": counter_opponent_last,
}
