from pathlib import Path

import pytest

from graphq import firing, unhealthy
from sentinel.ingest import monolith, otel, sandbox
from sentinel.seed.generator import seed_baseline
from sentinel.tools import actions, rootcause
from sentinel.tools.read import firing_alerts

BACKEND = Path(__file__).resolve().parents[1]


def analyzed(mode, fault, component="service"):
    spans, meta = otel.parse(sandbox.traffic(mode, fault), component)
    return otel.analyze(spans, meta)


# --- offline: trace analysis -------------------------------------------------------

def test_topology_comes_from_the_traces():
    found = analyzed("microservices", None)
    assert ("checkout", "payment") in found["calls"] and ("shipping", "quote") in found["calls"]
    assert ("payment", "checkout") not in found["calls"]
    assert found["dbs"] == {("cart", "valkey-cart"): "WRITES_TO"}
    assert all(c.status == "healthy" for c in found["components"].values())


@pytest.mark.parametrize("fault", sorted(sandbox.FAULTS))
def test_error_origin_is_the_failing_service(fault):
    comps = analyzed("microservices", fault)["components"]
    assert {c.name for c in comps.values() if c.root_fault} == {sandbox.FAULTS[fault][0]}
    assert comps["frontend-proxy"].status != "healthy"  # the symptom users see


@pytest.mark.parametrize("fault", sorted(sandbox.MONOLITH_FAULTS))
def test_monolith_modules_from_code_namespace(fault):
    comps = analyzed("monolith", fault, "module")["components"]
    assert set(comps) == set(sandbox.MODULES)
    assert {c.name for c in comps.values() if c.root_fault} == {sandbox.MONOLITH_FAULTS[fault][0]}


def test_otlp_enum_names_are_understood():
    payload = {"resourceSpans": [{"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "a"}}]},
                                  "scopeSpans": [{"spans": [
                                      {"traceId": "t", "spanId": "1", "kind": "SPAN_KIND_CLIENT",
                                       "status": {"code": "STATUS_CODE_ERROR"}}]}]}]}
    spans, _ = otel.parse(payload)
    assert spans[0].kind == otel.CLIENT and spans[0].error


def test_monolith_import_graph_of_this_repo():
    modules, edges = monolith.import_graph(BACKEND / "sentinel")
    assert {"sentinel.tools", "sentinel.db", "sentinel.api"} <= modules
    assert ("sentinel.tools", "sentinel.db") in edges and ("sentinel.api", "sentinel.tools") in edges
    assert ("sentinel.db", "sentinel.tools") not in edges


def test_alertmanager_ingest_parsing():
    from sentinel.ingest.alerts import ingest_alertmanager

    class MockGraph:
        def getVertices(self, *a, **kw):
            return []

        def upsertVertices(self, *a, **kw):
            pass

        def upsertEdges(self, *a, **kw):
            pass

        def upsertData(self, *a, **kw):
            pass

        def runInterpretedQuery(self, *a, **kw):
            return [{"S": [], "@@deps": {}, "@@alerts": {}}]

    payload = {
        "alerts": [
            {
                "status": "firing",
                "labels": {"alertname": "PodCrashing", "service": "cartservice", "severity": "critical"},
                "annotations": {"summary": "CrashLoopBackOff"},
            },
            {
                "status": "resolved",
                "labels": {"alertname": "OldAlert", "service": "paymentservice"},
            },
        ]
    }
    res = ingest_alertmanager(MockGraph(), payload)
    assert "alert:am-podcrashing-cartservice" in res["firing"]
    assert "alert:am-oldalert-paymentservice" in res["resolved"]
    assert res["affected_services"] == ["cartservice", "paymentservice"]


# --- against TigerGraph: the agent's tools on ingested data ------------------------

def test_sandbox_incident_is_found_and_fixed(graph):
    try:
        out = sandbox.load(graph, "microservices", "paymentFailure")
        assert out["incident"]["root_faults"] == ["payment"]
        alerting = out["incident"]["alerting"]
        top = rootcause.find_common_cause(alerting, graph)["result"]["candidates"][0]
        assert top["name"] == "payment" and top["likely_root_cause"]
        change = rootcause.recent_changes(["payment"], 60, graph)["result"]["changes"][0]
        assert change["version"] == "flag-paymentFailure"

        act = actions.propose_action("rollback", "payment", "flag change", graph=graph)["result"]["action"]["uid"]
        actions.execute_action(act, graph=graph)
        assert unhealthy(graph) == set() and firing(graph) == 0
    finally:
        seed_baseline(graph)  # leave the demo graph for the other tests


def test_monolith_sandbox_points_at_the_module_and_commit(graph):
    try:
        out = sandbox.load(graph, "monolith", "inventoryLockTimeout")
        top = rootcause.find_common_cause(out["incident"]["alerting"], graph)["result"]["candidates"][0]
        assert top["name"] == "shop.inventory"
        change = rootcause.recent_changes(["shop.inventory"], 60, graph)["result"]["changes"][0]
        assert change["message"] == sandbox.MONOLITH_FAULTS["inventoryLockTimeout"][1]
    finally:
        seed_baseline(graph)


# --- DevBrowser traffic --------------------------------------------------------------

def browser_records(failing_status=503):
    page = "http://localhost:3000/cart"
    rec = lambda url, status, mime="application/json": {  # noqa: E731
        "pageUrl": page, "url": url, "method": "GET", "statusCode": status, "mimeType": mime,
        "startTime": 1_700_000_000_000, "endTime": 1_700_000_000_040}
    return ([rec("http://localhost:3000/_next/app.js", 200, "application/javascript"),
             rec("http://localhost:3000/logo.png", 200, "image/png")]
            + [rec("http://api.shop.local/cart", 200) for _ in range(10)]
            + [rec("http://payments.shop.local/charge", failing_status) for _ in range(4)]
            + [rec("http://api.shop.local/missing", 404)])


def test_browser_traffic_becomes_dependencies():
    from sentinel.ingest.browser import to_otlp

    spans, meta = otel.parse(to_otlp(browser_records()))
    found = otel.analyze(spans, meta)
    assert set(found["calls"]) == {("web:localhost:3000", "api.shop.local"),
                                   ("web:localhost:3000", "payments.shop.local")}  # assets are not calls
    comps = found["components"]
    assert comps["payments.shop.local"].root_fault and comps["payments.shop.local"].status == "down"
    assert comps["api.shop.local"].status == "healthy"  # a 404 is the caller's mistake
    assert not comps["web:localhost:3000"].root_fault and comps["web:localhost:3000"].status != "healthy"


def test_browser_traffic_through_the_api(graph, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr("sentinel.api.main.get_graph", lambda name=None: graph)
    monkeypatch.setattr("sentinel.tools.common.get_graph", lambda name=None: graph)
    from sentinel.api.main import app

    try:
        seed_baseline(graph)
        with TestClient(app, headers={"X-Admin-Token": "test-admin-token"}) as c:
            out = c.post("/api/browser-traffic", json=browser_records()).json()
            assert out["components"] == 3 and out["alerting"] == []  # passive capture: topology only
            assert "payments.shop.local" not in unhealthy(graph) and firing(graph) == 0
            radius = c.get("/api/services/payments.shop.local/blast-radius").json()
            assert [r["name"] for r in radius["result"]["impacted"]] == ["web:localhost:3000"]
            assert c.get("/api/services/nope/dependencies").status_code == 404
    finally:
        seed_baseline(graph)


def test_recovery_needs_a_sustained_healthy_window(graph):
    """Fail fast, recover slowly: one clean batch in a noisy stream must not resolve a firing alert."""
    seed_baseline(graph)
    try:
        bad, good = analyzed("microservices", "paymentFailure"), analyzed("microservices", None)
        t0 = 1_800_000_000_000
        otel.write(graph, bad, at=t0)
        assert "payment" in unhealthy(graph) and firing(graph) > 0
        out = otel.write(graph, good, at=t0 + 2_000)  # a lucky window 2 s later
        assert "payment" in out["recovering"] and "payment" in unhealthy(graph) and firing(graph) > 0
        out = otel.write(graph, good, at=t0 + otel.RECOVERY_MS)
        assert out["recovering"] == [] and "payment" not in unhealthy(graph)
        assert not any(a["service"] == "payment" for a in firing_alerts(graph))
    finally:
        seed_baseline(graph)
