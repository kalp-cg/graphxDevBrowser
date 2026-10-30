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


def test_scan_monorepo_that_builds_everything_from_the_root(tmp_path):
    """The OpenTelemetry Demo layout: `context: ./`, Dockerfile paths and ports from `.env`, plumbing services."""
    (tmp_path / ".env").write_text("API_DOCKERFILE=./src/api/Dockerfile\nAPI_PORT=8080\nDB_PORT=5432\n")
    for name, marker in (("api", "go.mod"), ("web", "package.json"), ("billing", "billing.csproj")):
        (tmp_path / "src" / name).mkdir(parents=True)
        (tmp_path / "src" / name / marker).write_text("")
    (tmp_path / "src" / "api" / "Dockerfile").write_text("FROM golang:1.22\n")
    (tmp_path / ".github").mkdir()
    (tmp_path / ".github" / "CODEOWNERS").write_text("* @acme/platform\n/src/billing/ @acme/money\n")
    (tmp_path / "docker-compose.yml").write_text("""
services:
  api:
    build: {context: ./, dockerfile: "${API_DOCKERFILE}"}
    ports: ["${API_PORT}:8080"]
    environment: [OTEL_ENDPOINT=http://otel-collector:4317, BILLING_ADDR=billing:${API_PORT}, FLAGD_HOST=flagd]
    depends_on: [db, flagd]
  web:
    build: {context: ./}
    environment: [API_URL=http://api:8080]
  billing:
    build: {context: ./}
  db:
    image: postgres:16
    ports: ["${DB_PORT}:5432"]
  otel-collector: {image: "otel/opentelemetry-collector-contrib:0.1"}
  flagd: {image: "ghcr.io/open-feature/flagd:v0"}
  load-generator: {build: {context: ./}}
  special: {build: {context: ./}, labels: {sentinel.ignore: "false"}, image: "x/jaeger-shim"}
""")
    m = codebase.scan(tmp_path)
    svc = {s["name"]: s for s in m["services"]}
    assert set(svc) == {"api", "web", "billing", "special"}  # plumbing is not part of the product
    assert m["ignored"] == ["flagd", "load-generator", "otel-collector"]
    assert (svc["api"]["path"], svc["api"]["language"]) == ("src/api", "go")
    assert svc["web"]["language"] == "javascript" and svc["billing"]["language"] == "csharp"
    assert svc["billing"]["team"] == "money" and svc["api"]["team"] == "platform"
    assert {tuple(d) for d in m["dependencies"]} == {("api", "billing"), ("api", "db"), ("web", "api")}
    assert m["aliases"]["localhost:8080"] == "api" and m["aliases"]["localhost:5432"] == "db"
    assert svc["api"]["layer"] == "business"  # published, but web calls it: not an entry point


def test_scan_kubernetes_manifests_without_compose(tmp_path):
    for n in ("web", "orders", "ledger"):
        (tmp_path / "src" / n).mkdir(parents=True)
    (tmp_path / "src" / "orders" / "go.mod").write_text("")
    (tmp_path / "src" / "ledger" / "pom.xml").write_text("")
    (tmp_path / "k8s").mkdir()

    def deployment(name, image, env=()):
        envs = "".join(f"\n        - {{name: E{i}, value: \"{v}\"}}" for i, v in enumerate(env))
        return (f"apiVersion: apps/v1\nkind: Deployment\nmetadata: {{name: {name}}}\nspec:\n  selector: {{matchLabels: {{app: {name}}}}}\n"
                f"  template:\n    spec:\n      containers:\n      - name: c\n        image: {image}\n        ports: [{{containerPort: 8080}}]\n"
                f"        env:{envs or ' []'}\n---\n")
    (tmp_path / "k8s" / "all.yaml").write_text(
        deployment("web", "web", ["http://orders:8080", "ledger:8080", "otel-collector:4317"])
        + deployment("orders", "orders", ["redis-cache:6379"]) + deployment("ledger", "ledger")
        + deployment("redis-cache", "redis:7") + deployment("otel-collector", "otel/collector")
        + "apiVersion: v1\nkind: Service\nmetadata: {name: web-external}\nspec: {type: LoadBalancer, selector: {app: web}, ports: [{port: 80}]}\n")
    (tmp_path / "k8s" / "chart.yaml").write_text("kind: Deployment\nname: {{ .Values.x }}\n")  # Helm template: skipped
    m = codebase.scan(tmp_path)
    svc = {s["name"]: s for s in m["services"]}
    assert m["source"] == "kubernetes" and set(svc) == {"web", "orders", "ledger"}
    assert svc["orders"]["language"] == "go" and svc["ledger"]["language"] == "java"
    assert svc["web"]["layer"] == "edge" and [d["name"] for d in m["databases"]] == ["redis-cache"]
    assert {tuple(d) for d in m["dependencies"]} == {("web", "orders"), ("web", "ledger"), ("orders", "redis-cache")}
    assert m["ignored"] == ["otel-collector"]


def test_scan_finds_compose_in_deploy_folder_and_survives_odd_yaml(tmp_path):
    (tmp_path / "deploy" / "compose").mkdir(parents=True)
    (tmp_path / "svc" / "api").mkdir(parents=True)
    (tmp_path / "svc" / "api" / "go.mod").write_text("")
    # unset variables leave `image: name:` which text-level substitution would turn into invalid YAML
    (tmp_path / "deploy" / "compose" / "docker-compose.yml").write_text(
        "services:\n  api:\n    build: ../../svc/api\n    depends_on: [cache]\n  cache:\n    image: redis:${TAG}\n"
        "  zookeeper:\n    build: ./zk\n  dynamodblocal:\n    build: ./dy\n  api-init:\n    image: x\n")
    m = codebase.scan(tmp_path)
    assert [(s["name"], s["path"], s["language"]) for s in m["services"]] == [("api", "svc/api", "go")]
    assert {d["name"] for d in m["databases"]} == {"cache", "zookeeper", "dynamodblocal"} and m["ignored"] == ["api-init"]
    (tmp_path / "docker-compose.yml").write_text("services: [unclosed\n  - : :")
    with pytest.raises(ValueError, match="not valid YAML"):
        codebase.scan(tmp_path)


def _nextjs_monolith(root, compose: bool):
    def write(rel, text=""):
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    write("package.json", '{"dependencies": {"next": "14", "@prisma/client": "5"}}')
    write("tsconfig.json", '{\n // comments and trailing commas are normal here\n "compilerOptions": {"paths": {"@/*": ["./*"],},},\n}')
    write("prisma/schema.prisma", 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}')
    write("lib/prisma.ts", "import { PrismaClient } from '@prisma/client'\nexport const db = new PrismaClient()")
    write("lib/ai/agent.ts", "import { db } from '@/lib/prisma'\nconst k = process.env.GEMINI_API_KEY\nexport const run = () => db")
    write("lib/billing/invoice.ts", "import { run } from '../ai/agent'\nexport const x = run")
    write("app/api/orders/route.ts", "import { x } from '@/lib/billing/invoice'\nexport const GET = x")
    write("app/api/orders/[id]/route.ts", "import { run } from '@/lib/ai/agent'\nexport const GET = run")
    write("app/api/health/route.ts", "export const GET = () => 'ok'")
    write("app/page.tsx", "import Nav from '@/components/Nav'\nexport default Nav")
    write("components/Nav.tsx", "export default () => null")
    write("lib/ai/agent.test.ts", "import { run } from './agent'")  # tests are not modules
    write("next.config.ts", "export default {}")
    write(".env.example", "DATABASE_URL=\nGEMINI_API_KEY=\nQDRANT_URL=\n")  # QDRANT is declared, never used
    if compose:
        write("docker-compose.yml", "services:\n  app:\n    build: {context: ., dockerfile: Dockerfile}\n    depends_on: [postgres]\n"
                                    "    ports: ['3000:3000']\n  postgres:\n    image: postgres:15\n")
        write("Dockerfile", "FROM node:20\n")


@pytest.mark.parametrize("compose", [True, False])
def test_scan_maps_the_modules_of_a_monolith(tmp_path, compose):
    _nextjs_monolith(tmp_path, compose)
    m = codebase.scan(tmp_path)
    svc = {s["name"]: s for s in m["services"]}
    assert set(svc) == {"api.orders", "api.health", "app", "components", "lib", "lib.ai", "lib.billing", "gemini-api"}
    assert svc["api.orders"]["layer"] == "edge" and svc["lib.ai"]["layer"] == "business"
    assert svc["gemini-api"]["kind"] == "external" and svc["gemini-api"]["layer"] == "platform"
    assert all(svc[n]["kind"] == "module" for n in svc if n != "gemini-api") and svc["lib.ai"]["language"] == "typescript"
    deps = {tuple(d) for d in m["dependencies"]}
    assert {("api.orders", "lib.billing"), ("api.orders", "lib.ai"), ("lib.billing", "lib.ai"), ("lib.ai", "lib"),
            ("app", "components"), ("lib.ai", "gemini-api")} <= deps
    db = "postgres" if compose else "prisma-db"  # the compose database when there is one
    assert [d["name"] for d in m["databases"]] == [db] and ("lib", db) in deps
    assert not any("qdrant" in n for n in svc) and not any(d == "qdrant" for _a, d in deps)
    assert m["source"].endswith("+ code imports")
    if compose:
        assert m["aliases"]["localhost:3000"] == "app"  # browser traffic lands on a module that exists


def test_a_folder_named_like_the_service_is_not_the_service(tmp_path):
    """`app/` is Next.js's page router; the compose service called `app` is the repository."""
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "page.tsx").write_text("export default 1")
    (tmp_path / "Dockerfile").write_text("FROM node:20\n")
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "docker-compose.yml").write_text("services:\n  app:\n    build: .\n")
    m = codebase.scan(tmp_path)
    assert [(s["name"], s["path"], s["language"]) for s in m["services"]] == [("app", "", "javascript")]


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
    with TestClient(app) as c:
        yield c
    wipe(graph)


def test_workspace_scan_through_the_api(api, graph):
    manifest = codebase.scan(SHOP)
    out = api.post("/api/workspace", json=manifest).json()
    assert out["services"] == 7 and out["databases"] == 2 and out["teams"] == 4
    assert api.get("/api/workspace").json()["aliases"]["localhost:7404"] == "checkout"
    assert api.post("/api/workspace", json={"services": []}).status_code == 422

    # A re-scan of a broken system leaves runtime state alone.
    graph.upsertVertices("Service", [("svc:inventory", {"status": "down", "root_fault": True})])
    api.post("/api/workspace", json=manifest)
    assert unhealthy(graph) == {"inventory"}

    r = api.get("/api/resolve", params={"url": "http://127.0.0.1:7406/reserve"}).json()
    assert r["service"] == "inventory" and r["known"] and r["team"] == "fulfilment" and r["status"] == "down"
    assert r["blast_radius"]["count"] == 3 and set(r["blast_radius"]["impacted"]) == {"checkout", "gateway", "web"}
    assert api.get("/api/resolve", params={"url": "https://api.stripe.com/v1"}).json()["known"] is False


def test_workspace_scan_by_path(api, tmp_path):
    out = api.post("/api/workspace/scan", json={"path": str(SHOP)}).json()
    assert out["services"] == 7 and out["repo"] == "shop" and "checkout" in out["service_names"]
    assert api.get("/api/workspace").json()["aliases"]["localhost:7404"] == "checkout"
    assert api.post("/api/workspace/scan", json={"path": str(tmp_path / "nope")}).status_code == 422
    assert api.post("/api/workspace/scan", json={"path": str(tmp_path)}).status_code == 422  # no services in it


def test_scanning_a_different_codebase_replaces_the_graph(api, graph, tmp_path):
    other = {"repo": "legacy", "source": "docker-compose", "services": [
        {"name": "old-svc", "path": "", "language": "", "tier": "low", "revenue_per_min": 0, "team": None, "layer": "business"}],
        "databases": [], "dependencies": [], "aliases": {"old-svc": "old-svc"}, "changes": []}
    api.post("/api/workspace", json=other)
    first = api.post("/api/workspace/scan", json={"path": str(SHOP)}).json()
    assert first["replaced"] is True
    assert "old-svc" not in {v["v_id"].removeprefix("svc:") for v in graph.getVertices("Service", select="name")}
    graph.upsertVertices("Service", [("svc:inventory", {"status": "down", "root_fault": True})])
    again = api.post("/api/workspace/scan", json={"path": str(SHOP)}).json()
    assert again["replaced"] is False and unhealthy(graph) == {"inventory"}  # same repo: update, keep runtime state
    kept = api.post("/api/workspace/scan", json={"path": str(SHOP), "replace": False}).json()
    assert kept["replaced"] is False


def test_sandbox_chaos_breaks_the_real_shop_and_waits_for_the_alerts(api, graph, monkeypatch):
    import urllib.error

    from sentinel.seed import scenarios

    api.post("/api/workspace", json=codebase.scan(SHOP))
    sent = []

    def shop(cmd, timeout=10):
        sent.append(cmd)
        if cmd["action"] == "fault":  # the shop's failing traces become alerts a moment later
            scenarios.inject_chaos(cmd["service"], "down", False, graph)
        return {"ok": True}

    monkeypatch.setattr(scenarios, "_shop", shop)
    out = scenarios.sandbox_chaos("inventory", "down", True, graph, wait_s=3)
    assert [c["action"] for c in sent] == ["reset", "fault"]
    assert sent[1]["service"] == "inventory" and sent[1]["rate"] == 1.0 and sent[1]["deploy"]["version"].startswith("v9.")
    assert out["target"] == "inventory" and out["alerting_services"] == ["checkout"] and out["deploy"]

    sent.clear()
    scenarios.sandbox_chaos("inventory", "degraded", False, graph, wait_s=1)
    assert sent[1]["rate"] == 0.5 and "deploy" not in sent[1]

    def shop_down(cmd, timeout=10):
        raise urllib.error.URLError("refused")

    monkeypatch.setattr(scenarios, "_shop", shop_down)
    assert scenarios.sandbox_chaos("inventory", "down", False, graph, wait_s=1) is None  # caller falls back to the graph
    with pytest.raises(ValueError):
        scenarios.sandbox_chaos("no-such-service", "down", False, graph)


def test_scan_maps_a_host_folder_to_where_the_container_mounts_it(api, monkeypatch):
    monkeypatch.setenv("SENTINEL_PROJECTS_HOST", "/Users/dev/code")
    monkeypatch.setenv("SENTINEL_PROJECTS_MOUNT", str(SHOP.parent))
    assert api.post("/api/workspace/scan", json={"path": "/Users/dev/code/shop"}).json()["repo"] == "shop"
    assert api.post("/api/workspace/scan", json={"path": "/Users/dev/other"}).status_code == 422  # outside the mount


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
