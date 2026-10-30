import asyncio

from sentinel import sandbox
from sentinel.agent.autopilot import Autopilot
from sentinel.agent.mcp_client import GraphToolbox


def test_the_company_is_big_and_cases_cover_the_hard_shapes(graph):
    c = sandbox.load_company(graph)
    assert 30 <= c["services"] <= 40 and c["databases"] >= 5 and c["teams"] >= 5 and c["engineers"] >= 15 and c["past_incidents"] >= 3
    cases = sandbox.build_cases(graph, 12)
    ids = [x.id for x in cases]
    assert len(cases) == 12 and ids[0] == "control" and cases[0].expected == []
    assert {"database", "two-failures", "three-failures", "degraded"} <= set(ids)
    assert [x.id for x in sandbox.build_cases(graph, 12)] == ids   # the same exam every time
    assert len(sandbox.build_cases(graph, 3)) == 3


def test_judge_scores_outcomes_not_style(graph):
    case = sandbox.Case("x", "x", "easy", ["a", "b"])
    j = lambda f: sandbox.judge(case, {"root_causes": f})[0]  # noqa: E731
    assert j(["a", "b"]) == "correct" and j(["a"]) == "partial" and j([]) == "missed"
    assert j(["a", "b", "c"]) == "extra" and j(["z"]) == "wrong"
    control = sandbox.Case("c", "c", "easy", [])
    assert sandbox.judge(control, {})[0] == "correct"
    assert sandbox.judge(control, {"root_cause": "x"})[0] == "false-alarm"


def test_summary_separates_the_chosen_model_from_the_fallback():
    r = lambda ok, fb: {"correct": ok, "fallback": fb, "outcome": "correct" if ok else "wrong", "seconds": 1, "expected": ["a"],  # noqa: E731
                        "difficulty": "easy"}
    s = sandbox.summarize([r(True, False), r(False, False), r(True, True), r(True, True)])
    assert (s["correct"], s["fell_back_to_builtin"], s["answered_by_chosen"], s["accuracy_of_chosen"]) == (3, 2, 2, 0.5)
    assert sandbox.summarize([r(True, True)])["accuracy_of_chosen"] is None


def test_the_builtin_agent_passes_a_sample_of_the_exam(graph):
    import os

    os.environ["TG_GRAPH"] = "Sentinel_test"   # the toolbox is a subprocess; it reads this
    sandbox.load_company(graph)
    cases = {c.id: c for c in sandbox.build_cases(graph, 12)}

    async def go():
        tb = await GraphToolbox().start()
        try:
            return [await sandbox.run_case(graph, cases[c], tb, Autopilot()) for c in ("control", "database", "two-failures")]
        finally:
            await tb.close()

    results = asyncio.run(go())
    assert all(r["correct"] for r in results), [(r["id"], r["outcome"], r["why"]) for r in results]


def test_the_exam_runs_through_the_api_and_leaves_the_company_healthy(graph, monkeypatch):
    import time

    from fastapi.testclient import TestClient

    from sentinel.seed.generator import wipe

    monkeypatch.setenv("TG_GRAPH", "Sentinel_test")
    for target in ("sentinel.api.main.get_graph", "sentinel.api.graph_view.get_graph",
                   "sentinel.tools.common.get_graph", "sentinel.seed.scenarios.get_graph"):
        monkeypatch.setattr(target, lambda name=None: graph)
    from sentinel.api.main import app

    wipe(graph)
    with TestClient(app) as api:
        assert api.post("/api/sandbox/load").json()["services"] == 38
        assert api.post("/api/sandbox/test", json={"provider": "autopilot", "cases": 2}).json() == {"started": True}
        for _ in range(120):
            exam = api.get("/api/sandbox").json()["exam"]
            if exam["status"] not in ("starting", "running"):
                break
            time.sleep(0.5)
        assert exam["status"] == "done" and exam["summary"]["cases"] == 2, exam
        assert {v["attributes"]["status"] for v in graph.getVertices("Service", select="name,status")} == {"healthy"}
    wipe(graph)
