"""On-call windows must not run out: paging has to keep working long after the graph was seeded."""
from graphq import pages_to
from sentinel.seed.generator import DAY_MS, refresh_on_call, seed_baseline
from sentinel.seed.scenarios import inject_scenario
from sentinel.tools import actions, read
from sentinel.tools.common import now_ms


def in_days(days: int) -> int:
    return now_ms() + days * DAY_MS


def fake_clock(monkeypatch, at: int) -> None:
    for module in (read, actions):
        monkeypatch.setattr(module, "now_ms", lambda: at)
    monkeypatch.setattr("sentinel.seed.generator.now_ms", lambda: at)


def oncall(graph, service="inventory-db-proxy"):
    return read.get_service_context(service, graph)["result"]["on_call"]


def test_baseline_windows_expire_after_30_days(graph, monkeypatch):
    """Documents the bug this guards against: without a refresh, nobody is on call 60 days later."""
    seed_baseline(graph)
    assert oncall(graph)
    fake_clock(monkeypatch, in_days(60))
    assert oncall(graph) == []


def test_refresh_restores_paging_60_days_later(graph, monkeypatch):
    inject_scenario("db-pool-exhaustion", graph, fresh=True)
    later = in_days(60)
    fake_clock(monkeypatch, later)
    assert oncall(graph) == []

    assert refresh_on_call(graph, later) > 0
    assert [p["handle"] for p in oncall(graph)] == ["priya"]

    uid = actions.propose_action("page_oncall", "inventory-db-proxy", "x", graph=graph)["result"]["action"]["uid"]
    out = actions.execute_action(uid, graph=graph)
    assert "Priya" in out["outcome"]
    assert pages_to(graph, "priya") == 1


def test_soft_reset_refreshes_windows(graph, monkeypatch):
    seed_baseline(graph)
    fake_clock(monkeypatch, in_days(60))
    inject_scenario("db-pool-exhaustion", graph)  # soft reset on an existing graph
    assert [p["handle"] for p in oncall(graph)] == ["priya"]
