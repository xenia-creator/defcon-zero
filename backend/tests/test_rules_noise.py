"""Checks that the Round 1 rules teams read state the engine's real noise rate.

The rate lives in the engine (engine/noise.py, DEFAULT_NOISE), but teams read it
as text in two other places: the API contract (docs/api.md) and the rules panel
in the editor (frontend/src/workspace/editor/games.ts). Nothing links text to
code, so a change to one could leave the others wrong without any error. This
test builds the sentence from the engine's number and fails if either place
does not contain it word for word.

It reads files only and never touches the database.
"""

from pathlib import Path

# Importing the bridge puts /engine on the import path, as it does for the app,
# so the test reads the same engine the backend runs.
import app.services.engine_bridge  # noqa: F401
from engine.noise import DEFAULT_NOISE

REPOSITORY = Path(__file__).resolve().parents[2]
RULE_FILES = [
    REPOSITORY / "docs" / "api.md",
    REPOSITORY / "frontend" / "src" / "workspace" / "editor" / "games.ts",
]


def noise_sentence() -> str:
    """The rules sentence, with the percentage taken from the engine.

    round() rather than int(), because 0.05 * 100 is 5.000000000000001 in
    floating point and a 7% rate would come out as 7.000000000000001.
    """
    percent = round(DEFAULT_NOISE * 100)
    return (
        f"Each move has a {percent}% chance of being flipped by accident, "
        "like a false alarm. Your bot sees the move that actually happened."
    )


def test_rules_text_matches_engine_noise() -> None:
    # The text shows a whole percentage, so a rate like 0.055 needs new wording
    # rather than being rounded into a sentence that is quietly wrong.
    assert abs(DEFAULT_NOISE * 100 - round(DEFAULT_NOISE * 100)) < 1e-9
    sentence = noise_sentence()
    for path in RULE_FILES:
        assert sentence in path.read_text(encoding="utf-8"), (
            f"{path.relative_to(REPOSITORY)} does not say: {sentence!r}"
        )
