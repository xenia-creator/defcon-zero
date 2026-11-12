"""Noise for one match.

The match owns a private random stream. Bots keep using the global `random`
module, which `play_match` seeds separately. The default Prisoner's Dilemma
noise probability is 7%.
"""

import math


DEFAULT_NOISE = 0.07


def validate_noise(noise):
    """Raise for a noise probability that is not a finite number from 0 to 1."""
    if isinstance(noise, bool) or not isinstance(noise, (int, float)):
        raise TypeError("noise must be a number")
    if not math.isfinite(noise) or not 0 <= noise <= 1:
        raise ValueError("noise must be between 0 and 1")


def apply_noise(move, actions, noise, rng):
    """Return the move that is actually played.

    Prisoner's Dilemma swaps `C` and `D`. Other games reject non-zero noise
    until a game-specific rule is approved.
    """
    validate_noise(noise)
    if not (noise and rng.random() < noise):
        return move
    if set(actions) == {"C", "D"}:
        return "D" if move == "C" else "C"
    alternatives = [action for action in actions if action != move]
    if len(alternatives) <= 1:
        return alternatives[0] if alternatives else move
    return rng.choice(alternatives)
