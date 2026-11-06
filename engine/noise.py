"""Noise for one match.

The match owns a private random stream. Bots keep using the global `random`
module, which `play_match` seeds separately. A noise level of 0 draws nothing.
"""


def apply_noise(move, actions, noise, rng):
    """Return the move that is actually played.

    Prisoner's Dilemma swaps `C` and `D`. Other games reject non-zero noise
    until a game-specific rule is approved.
    """
    if not (noise and rng.random() < noise):
        return move
    if set(actions) == {"C", "D"}:
        return "D" if move == "C" else "C"
    alternatives = [action for action in actions if action != move]
    if len(alternatives) <= 1:
        return alternatives[0] if alternatives else move
    return rng.choice(alternatives)
