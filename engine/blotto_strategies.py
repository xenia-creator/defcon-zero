"""Built-in Colonel Blotto strategies."""

import random
from itertools import combinations

EVEN_SPLIT = [3, 3, 2, 2]


def even_split(my_history, opp_history):
    return list(EVEN_SPLIT)


def all_in(my_history, opp_history):
    return [10, 0, 0, 0]


def random_allocation(my_history, opp_history):
    cuts = sorted(random.sample(range(1, 10), 3))
    points = (0, *cuts, 10)
    return [points[i + 1] - points[i] for i in range(4)]


def copy_opponent_last(my_history, opp_history):
    return list(opp_history[-1]) if opp_history else list(EVEN_SPLIT)


def _allocations(total, fronts):
    if fronts == 1:
        yield (total,)
        return
    for first in range(total + 1):
        for rest in _allocations(total - first, fronts - 1):
            yield (first, *rest)


def _score_against(candidate, opponent):
    return sum(
        1 if mine > theirs else 0.5 if mine == theirs else 0
        for mine, theirs in zip(candidate, opponent)
    )


def counter_opponent_last(my_history, opp_history):
    if not opp_history:
        return list(EVEN_SPLIT)
    previous = opp_history[-1]
    candidates = _allocations(10, 4)
    best = max(candidates, key=lambda allocation: _score_against(allocation, previous))
    return list(best)


BLOTTO_BOTS = {
    "even_split": even_split,
    "all_in": all_in,
    "random_allocation": random_allocation,
    "copy_opponent_last": copy_opponent_last,
    "counter_opponent_last": counter_opponent_last,
}
