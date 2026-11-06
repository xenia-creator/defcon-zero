"""Noise for one match.

The match owns a private random stream. Bots keep using the global `random`
module, which `play_match` seeds separately. A noise level of 0 draws nothing.
"""


def apply_noise(move, actions, noise, rng):
    """Return the move that is actually played.

    Prisoner's Dilemma swaps `AID` and `WITHHOLD`. Colonel Blotto noise is
    undefined and is rejected by the match runner.
    """
    if not (noise and rng.random() < noise):
        return move
    if set(actions) == {"AID", "WITHHOLD"}:
        return "WITHHOLD" if move == "AID" else "AID"
    alternatives = [action for action in actions if action != move]
    if len(alternatives) <= 1:
        return alternatives[0] if alternatives else move
    return rng.choice(alternatives)
