"""Codebase scan -> graph, identity resolution, and the API the DevBrowser integration uses."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_GRAPH
from graphq import firing, unhealthy
from sentinel import workspace
from sentinel.ingest import codebase
from sentinel.ingest.browser import to_otlp
from sentinel.seed.generator import wipe

SHOP = Path(__file__).resolve().parents[2] / "sandbox" / "shop"


def test_scan_reads_compose_codeowners_and_labels():
    m = codebase.scan(SHOP)
    svc = {s["name"]: s for s in m["services"]}
    assert set(svc) == {"web", "gateway", "catalog", "cart", "checkout", "payments", "inventory"}
    assert {d["name"]: d["engine"] for d in m["databases"]} == {"orders-db": "postgresql", "cache": "redis"}
    deps = {tuple(d) for d in m["dependencies"]}
    # depends_on, plain service URLs and credentialed URLs (postgres://user:pass@orders-db) all count
    assert {("web", "gateway"), ("gateway", "checkout"), ("checkout", "inventory"),
            ("inventory", "orders-db"), ("cart", "cache")} <= deps
    assert svc["checkout"]["team"] == "payments" and svc["checkout"]["tier"] == "critical"
    assert svc["checkout"]["revenue_per_min"] == 1200 and svc["checkout"]["language"] == "python"
    assert svc["gateway"]["layer"] == "edge" and svc["web"]["layer"] == "edge"  # label, then entry point
    assert svc["inventory"]["layer"] == "business"
    assert m["aliases"]["localhost:7404"] == "checkout" and m["aliases"]["checkout:8000"] == "checkout"


def test_scan_without_compose_uses_package_directories(tmp_path):
    (tmp_path / "services" / "billing").mkdir(parents=True)
    (tmp_path / "services" / "billing" / "go.mod").write_text("module billing\n")
    (tmp_path / "apps" / "site").mkdir(parents=True)
    (tmp_path / "apps" / "site" / "package.json").write_text("{}")
    (tmp_path / "apps" / "site" / "tsconfig.json").write_text("{}")
    (tmp_path / "CODEOWNERS").write_text("* @acme/everyone\nbilling/ @acme/money\n")
    m = codebase.scan(tmp_path)
    svc = {s["name"]: s for s in m["services"]}
    assert svc["billing"]["language"] == "go" and svc["billing"]["team"] == "money"  # unanchored, last wins
    assert svc["site"]["language"] == "typescript" and svc["site"]["team"] == "everyone"
    assert m["source"] == "directories" and m["dependencies"] == []


def test_host_normalization_and_resolution():
    aliases = {"localhost:7404": "checkout"}
    assert workspace.host_of("http://127.0.0.1:7404/x?y=1") == "localhost:7404"
    assert workspace.host_of("https://user@API.Example.com/v1") == "api.example.com"
    assert workspace.host_of("http://[::1]:7404/") == "localhost:7404"
    assert workspace.resolve("http://0.0.0.0:7404/checkout", aliases) == "checkout"
    assert workspace.resolve("https://api.stripe.com/v1", aliases) is None


def test_browser_traffic_lands_on_scanned_services():
    aliases = codebase.scan(SHOP)["aliases"]
    rec = {"pageUrl": "http://localhost:7400/", "url": "http://127.0.0.1:7401/api/cart", "method": "GET",
           "statusCode": 200, "mimeType": "application/json", "startTime": 1, "endTime": 2}
    names = {r["resource"]["attributes"][0]["value"]["stringValue"] for r in to_otlp([rec], aliases)["resourceSpans"]}
    assert names == {"web", "gateway"}  # not web:localhost:7400 / localhost:7401


@pytest.fixture
def api(graph, monkeypatch):
    monkeypatch.setenv("TG_GRAPH", TEST_GRAPH)  # the agent's MCP tool server is a subprocess
    for target in ("sentinel.api.main.get_graph", "sentinel.api.graph_view.get_graph",
                   "sentinel.tools.common.get_graph"):
        monkeypatch.setattr(target, lambda name=None: graph)
    from sentinel.api.main import app

    wipe(graph)
    with TestClient(app, headers={"X-Admin-Token": "test-admin-token"}) as c:
        yield c
    wipe(graph)


def test_workspace_scan_through_the_api(api, graph):
    manifest = codebase.scan(SHOP)
    out = api.post("/api/workspace", json=manifest).json()
    assert out["services"] == 7 and out["databases"] == 2 and out["teams"] == 4
    assert api.get("/api/workspace").json()["aliases"]["localhost:7404"] == "checkout"
    assert api.post("/api/workspace", json={"services": []}).status_code == 422
    assert TestClient(api.app).post("/api/workspace", json=manifest).status_code == 401

    # A re-scan of a broken system leaves runtime state alone.
    graph.upsertVertices("Service", [("svc:inventory", {"status": "down", "root_fault": True})])
    api.post("/api/workspace", json=manifest)
    assert unhealthy(graph) == {"inventory"}

    r = api.get("/api/resolve", params={"url": "http://127.0.0.1:7406/reserve"}).json()
    assert r["service"] == "inventory" and r["known"] and r["team"] == "fulfilment" and r["status"] == "down"
    assert r["blast_radius"]["count"] == 3 and set(r["blast_radius"]["impacted"]) == {"checkout", "gateway", "web"}
    assert api.get("/api/resolve", params={"url": "https://api.stripe.com/v1"}).json()["known"] is False


def test_passive_traffic_never_changes_health(api, graph):
    api.post("/api/workspace", json=codebase.scan(SHOP))
    bad = [{"pageUrl": "http://localhost:7400/", "url": "http://localhost:7401/api/checkout", "method": "POST",
            "statusCode": 502, "mimeType": "application/json", "startTime": 1, "endTime": 2}] * 5
    api.post("/api/browser-traffic", json=bad)
    assert unhealthy(graph) == set() and firing(graph) == 0


def test_investigate_this_failure(api, graph):
    """DevBrowser's button: the failed request is evidence; the run starts from it and reports back."""
    api.post("/api/workspace", json=codebase.scan(SHOP))
    ev = {"url": "http://localhost:7401/api/checkout", "method": "POST", "status_code": 502,
          "page_url": "http://localhost:7400/"}
    with api.websocket_connect("/ws") as ws:
        ws.receive_json()
        run_id = api.post("/api/runs", json={"provider": "autopilot", "evidence": [ev]}).json()["run_id"]
        events = []
        while not events or events[-1]["type"] not in ("final", "error"):
            events.append(ws.receive_json())
    started = next(e for e in events if e["type"] == "run_started")
    assert "(service `gateway`) returned 502" in started["question"]
    cur = api.get("/api/runs/current").json()
    assert cur["run_id"] == run_id and not cur["running"]
    assert cur["events"][-1]["type"] == "final" and all(e["run_id"] == run_id for e in cur["events"])
    assert cur["events"][-1]["root_cause"] == "gateway"  # the deepest failure the evidence shows
