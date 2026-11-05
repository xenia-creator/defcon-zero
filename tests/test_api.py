import pytest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

GOOD_BOT = "def strategy(my_history, opp_history):\n    return opp_history[-1] if opp_history else 'C'\n"


@pytest.fixture(autouse=True)
def empty_store():
    client.post("/api/demo/clear")
    yield
    client.post("/api/demo/clear")


def test_games_and_strategies():
    games = client.get("/api/games").json()
    assert [g["key"] for g in games] == ["prisoners_dilemma", "chicken", "stag_hunt"]
    assert games[0]["payoffs"]["C"]["D"] == [0, 5]

    strategies = {s["name"]: s for s in client.get("/api/strategies").json()}
    assert "def tit_for_tat" in strategies["tit_for_tat"]["source"]
    assert strategies["always_defect"]["description"] == "Always defects."


def test_load_demo_and_list_teams():
    loaded = client.post("/api/demo/load").json()["loaded"]
    assert len(loaded) == 20
    teams = client.get("/api/bots").json()
    assert [t["team_name"] for t in teams] == loaded
    assert "code" not in teams[0]


def test_submit_list_and_delete_bot():
    response = client.post("/api/bots", json={"team_name": "red_team", "code": GOOD_BOT})
    assert response.status_code == 201
    assert client.post("/api/bots", json={"team_name": "red_team", "code": GOOD_BOT}).status_code == 409
    assert client.post("/api/bots", json={"team_name": "tit_for_tat", "code": GOOD_BOT}).status_code == 409

    assert client.delete("/api/bots/red_team").status_code == 204
    assert client.get("/api/bots").json() == []
    assert client.delete("/api/bots/red_team").status_code == 404


def test_bad_bot_rejected_with_clear_error():
    tested = client.post("/api/bots/test", json={"code": "import os\n\ndef strategy(a, b):\n    return 'C'\n"}).json()
    assert tested["ok"] is False
    assert "importing 'os' is not allowed" in tested["errors"][0]

    crashing = "def strategy(my_history, opp_history):\n    return opp_history[0]\n"
    response = client.post("/api/bots", json={"team_name": "crasher", "code": crashing})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["message"] == "Bot failed testing."
    assert any("IndexError" in e and "(line 2)" in e for e in detail["errors"])
    assert client.get("/api/bots").json() == []


def test_tournament_with_demo_teams():
    client.post("/api/demo/load")
    response = client.post("/api/tournament", json={
        "bots": ["coop_50", "majority_3", "crash_zero_div"], "include_builtins": True,
        "game": "chicken", "turns": 100, "repetitions": 2, "seed": 7,
    })
    assert response.status_code == 200
    result = response.json()
    names = [row["name"] for row in result["leaderboard"]]
    assert "coop_50" in names and "tit_for_tat" in names
    assert result["disqualified"] == ["crash_zero_div"]
    assert result["forfeits"][0]["reason"].startswith("raised ZeroDivisionError")
    assert set(result["matrix"]) == set(names)
    assert isinstance(result["matrix"]["coop_50"]["tit_for_tat"], float)

    assert client.post("/api/tournament", json={"bots": ["nobody"]}).status_code == 404
    assert client.post("/api/tournament", json={"bots": []}).status_code == 422


def test_event_crowns_a_champion():
    assert client.post("/api/event", json={"seed": 2026}).status_code == 422

    client.post("/api/demo/load")
    result = client.post("/api/event", json={"seed": 2026, "include_builtins": True}).json()
    assert [r["name"] for r in result["rounds"]] == ["Opening Moves", "Fog of War", "Brinkmanship", "Endgame"]
    assert result["rounds"][0]["disqualified"] == ["crash_zero_div"]
    assert result["rounds"][-1]["advanced"] == [result["champion"]]
    assert result["champion"] in client.post("/api/demo/load").json()["loaded"]


def test_replay_match_turn_by_turn():
    response = client.get("/api/match", params={"p1": "tit_for_tat", "p2": "always_defect", "turns": 5})
    assert response.status_code == 200
    match = response.json()
    assert [t["moves"] for t in match["timeline"]] == [["C", "D"]] + [["D", "D"]] * 4
    assert match["timeline"][0]["scores"] == [0, 5]
    assert match["timeline"][-1]["totals"] == match["final_scores"] == [4, 9]
    assert match["forfeit"] is None


def test_replay_team_forfeit_keeps_completed_turns():
    client.post("/api/demo/load")
    match = client.get("/api/match", params={"p1": "crash_zero_div", "p2": "grudger", "turns": 100}).json()
    assert len(match["timeline"]) == 50
    assert match["forfeit"]["bot"] == "crash_zero_div" and match["forfeit"]["player"] == 1
    assert match["final_scores"] == [0, 300]

    seeded = {"p1": "coop_50", "p2": "coop_50", "noise": 0.1, "seed": 3}
    assert client.get("/api/match", params=seeded).json() == client.get("/api/match", params=seeded).json()
    assert client.get("/api/match", params={"p1": "coop_50", "p2": "nobody"}).status_code == 404
