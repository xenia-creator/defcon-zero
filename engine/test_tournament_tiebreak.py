from engine.tournament import break_tie, summarize


def test_head_to_head_wins_resolve_a_two_team_tie():
    order = break_tie(
        ["team-b", "team-a"],
        [
            ("team-a", "team-b", 3, 1),
            ("team-a", "team-b", 2, 1),
        ],
        seed=17,
    )
    assert order == ["team-a", "team-b"]


def test_head_to_head_ignores_teams_outside_the_tie_and_draws():
    order = break_tie(
        ["a", "b"],
        [
            ("a", "b", 1, 1),
            ("a", "outside", 0, 100),
        ],
        seed=9,
    )
    assert set(order) == {"a", "b"}


def test_multiple_teams_use_head_to_head_win_counts_before_random_ties():
    order = break_tie(
        ["c", "a", "b"],
        [
            ("a", "b", 2, 0),
            ("b", "c", 2, 0),
            ("c", "a", 2, 0),
            ("a", "c", 3, 1),
        ],
        seed=1,
    )
    assert order[0] == "a"
    assert set(order[1:]) == {"b", "c"}


def test_unavailable_head_to_head_results_are_coin_flipped_reproducibly():
    records = [
        {"player_a": "a", "player_b": "b", "score_a": None, "score_b": None},
        {"player_a": "b", "player_b": "c", "score_a": 1, "score_b": 1},
    ]
    first = break_tie(["a", "b", "c"], records, seed=2026)
    second = break_tie(["a", "b", "c"], records, seed=2026)
    assert first == second
    assert set(first) == {"a", "b", "c"}


def test_break_tie_returns_an_order_while_summary_ranks_remain_tied():
    ranking = summarize(
        ["a", "b"],
        [("a", "b", 10, 10)],
        turns=1,
        repetitions=1,
    )["leaderboard"]
    assert [row["rank"] for row in ranking] == [1, 1]
    assert break_tie(["a", "b"], [], seed=3) in (
        ["a", "b"], ["b", "a"],
    )


def test_invalid_head_to_head_record_shape_is_reported():
    try:
        break_tie(["a", "b"], [("a", "b", 1)], seed=1)
    except ValueError as error:
        assert "4-item tuples" in str(error)
    else:
        raise AssertionError("malformed head-to-head record was accepted")
