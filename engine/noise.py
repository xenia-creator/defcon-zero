"""Noise for one match.

The match owns a private random stream. Bots keep using the global `random`
module, which `play_match` seeds separately. A noise level of 0 draws nothing.
"""


def apply_noise(move, actions, noise, rng):
    """Return the move that is actually played.

    Round 1 flips between `C` and `D` (any move other than `C` becomes `C`).
    Round 2 replaces the move with one of the other two actions.
    Round 3 swaps `AID` and `WITHHOLD`.
    """
    if not (noise and rng.random() < noise):
        return move
    # Preserve the original Round 1 flip, including an invalid non-C move.
    if set(actions) == {"C", "D"}:
        return "D" if move == "C" else "C"
    alternatives = [action for action in actions if action != move]
    if len(alternatives) <= 1:
        return alternatives[0] if alternatives else move
    return rng.choice(alternatives)
