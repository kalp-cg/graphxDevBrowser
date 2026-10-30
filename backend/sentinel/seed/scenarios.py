"""Incident scenarios and the soft reset that sits between them.

`soft_reset` restores a healthy, quiet infrastructure but **keeps learned memory**: incidents the agent
resolved (and the alerts, actions and deployments they point to) survive, so re-running a similar incident
can be faster. `seed_baseline` (python -m sentinel.seed --reset) is the hard reset that wipes everything.
"""
import json
import os
import random
import time
import urllib.error
import urllib.request
import uuid

from ..db import Batch, Graph, attrs, get_graph, link, run, upsert
from .catalog import CHAOS_CHANGES
from .generator import now_ms, on_call_window, seed_baseline
from .history import create_deployments, sha_for

MIN_MS = 60 * 1000

SCENARIOS: dict[str, dict] = {
    "db-pool-exhaustion": {
        "title": "Checkout, cart and orders slow down",
        "deploy": {"svc": "inventory-db-proxy", "version": "v4.2.0", "minutes_ago": 6, "author": "priya",
                   "message": "Reduce max pool size to 10 to cut DB costs"},
        "root": ("inventory-db-proxy", "down"),
        "alerts": [("checkout-api", "p99_latency_ms", 8700, 800),
                   ("cart-service", "p99_latency_ms", 6100, 600),
                   ("orders-service", "p99_latency_ms", 5400, 700)],
    },
    "bad-config-push": {
        "title": "Login and profile latency spike",
        "deploy": {"svc": "feature-flags", "version": "v4.0.3", "minutes_ago": 8, "author": "eva",
                   "message": "Roll out strict-session-validation to 100% of traffic"},
        "root": ("feature-flags", "degraded"),
        "alerts": [("auth-service", "p99_latency_ms", 2900, 500),
                   ("user-profile", "p99_latency_ms", 1800, 400)],
    },
    "cache-stampede": {
        # Red herring: the only recent deploy is on an unrelated service. The real cause has no deploy.
        "title": "Search and recommendations erroring",
        "deploy": {"svc": "email-sender", "version": "v4.0.3", "minutes_ago": 4, "author": "zoe",
                   "message": "Update order-confirmation email template"},
        "root": ("redis-cache", "degraded"),
        "alerts": [("search-service", "error_rate", 0.21, 0.02),
                   ("recommendations", "error_rate", 0.34, 0.05)],
    },
    "kafka-rebalance-storm": {
        # No seeded memory matches this one: the first run is a full investigation, the second can use
        # what the agent learned the first time.
        "title": "Payments, notifications and inventory lagging",
        "deploy": {"svc": "kafka-bus", "version": "v4.1.0", "minutes_ago": 5, "author": "dan",
                   "message": "Raise partitions 12 -> 48 and switch to eager rebalancing"},
        "root": ("kafka-bus", "degraded"),
        "alerts": [("payments-api", "consumer_lag_s", 95, 10),
                   ("notifications", "consumer_lag_s", 240, 30),
                   ("inventory-service", "consumer_lag_s", 120, 15)],
    },
}


# Healthy, quiet infrastructure with on-call windows re-centred on now (see refresh_on_call). Unfinished
# investigations don't become memory (recall only reads resolved incidents), and proposals nobody acted on expire.
QUIET_GSQL = """
INTERPRET QUERY (INT from_ms, INT to_ms) FOR GRAPH $graphname SYNTAX v2 {
  P = {Person.*};
  X = SELECT p FROM P:p -(ON_CALL>:e)- Team:t ACCUM e.from_ms = from_ms, e.to_ms = to_ms;
  S = {Service.*};
  S = SELECT s FROM S:s POST-ACCUM s.status = "healthy", s.root_fault = FALSE;
  X = SELECT s FROM S:s -(DEPENDS_ON>:e)- Service:t ACCUM e.breaker = "closed";
  D = {Database.*};
  D = SELECT d FROM D:d POST-ACCUM d.status = "healthy";
  A = {Alert.*};
  A = SELECT a FROM A:a WHERE a.status == "firing" POST-ACCUM a.status = "resolved";
  I = {Incident.*};
  I = SELECT i FROM I:i WHERE i.status != "resolved" POST-ACCUM i.status = "abandoned";
  C = {Action.*};
  C = SELECT c FROM C:c WHERE c.status == "pending" OR c.status == "approved" POST-ACCUM c.status = "expired";
  PRINT "ok";
}
"""

# Scenario leftovers that no incident points to are deleted; scenario deployments an incident still blames
# stay in history, rolled back.
CLEANUP_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  A = {Alert.*};
  Kept = SELECT a FROM A:a -(<TRIGGERED_BY)- Incident:i;
  A = A MINUS Kept;
  A = SELECT a FROM A:a ACCUM DELETE (a);
  C = {Action.*};
  Kept = SELECT c FROM C:c -(<RESOLVED_BY)- Incident:i;
  C = C MINUS Kept;
  C = SELECT c FROM C:c ACCUM DELETE (c);
  P = {Page.*};
  Kept = SELECT p FROM P:p -(<PAGED)- Incident:i;
  P = P MINUS Kept;
  P = SELECT p FROM P:p ACCUM DELETE (p);
  D = {Deployment.*};
  D = SELECT d FROM D:d WHERE d.origin == "scenario";
  Kept = SELECT d FROM D:d -(<ROOT_CAUSE)- Incident:i;
  Gone = D MINUS Kept;
  X = SELECT c FROM Gone:d -(CONTAINS>)- Commit:c ACCUM DELETE (c);
  Gone = SELECT d FROM Gone:d ACCUM DELETE (d);
  Kept = SELECT d FROM Kept:d POST-ACCUM d.status = "rolled_back";
  PRINT "ok";
}
"""


def soft_reset(graph: Graph) -> None:
    """Healthy, quiet infrastructure; learned incidents and everything they reference are kept."""
    run(graph, QUIET_GSQL, on_call_window())
    run(graph, CLEANUP_GSQL)


def _deploy(graph: Graph | Batch, svc: str, version: str, author: str, message: str, at: int) -> None:
    """Upsert a scenario deployment (re-running re-deploys the same change; memory may point at it)."""
    create_deployments(graph, [{"svc": svc, "version": version, "at": at, "summary": message,
                                "sha": sha_for(svc, version), "message": message, "files": 3, "author": author}],
                       origin="scenario")


def service_count(graph: Graph) -> int:
    # Not getVertexCount: its statistics lag behind deletes, so a wiped graph can still report services.
    return len(graph.getVertices("Service", select="name"))


def _fire(graph: Graph | Batch, alerts: list[dict], scenario: str, root: str | None = None) -> None:
    """Alerting services go degraded (except the root, which keeps its own status) and get a firing Alert."""
    upsert(graph, "Service", [{"uid": f"svc:{a['svc']}", "status": "degraded"} for a in alerts if a["svc"] != root])
    upsert(graph, "Alert", [{"uid": f"alert:{a['id']}", "id": a["id"], "metric": a["metric"], "value": a["value"],
                             "threshold": a["threshold"], "at": a["at"], "status": "firing", "scenario": scenario}
                            for a in alerts])
    link(graph, "Alert", "FIRED_ON", "Service", [(f"alert:{a['id']}", f"svc:{a['svc']}") for a in alerts])


def inject_scenario(name: str, graph: Graph | None = None, now: int | None = None, fresh: bool = False) -> dict:
    """Restore a healthy graph (soft reset, or a full re-seed if `fresh` or empty), then break things."""
    if name not in SCENARIOS:
        raise ValueError(f"unknown scenario {name!r}; choose one of {sorted(SCENARIOS)}")
    spec = SCENARIOS[name]
    graph = graph or get_graph()
    now = now or now_ms()
    has_data = bool(service_count(graph)) if not fresh else False
    if has_data:
        soft_reset(graph)
    else:
        seed_baseline(graph, now)

    batch = Batch()
    d = spec["deploy"]
    _deploy(batch, d["svc"], d["version"], d["author"], d["message"], now - d["minutes_ago"] * MIN_MS)

    root, root_status = spec["root"]
    upsert(batch, "Service", [{"uid": f"svc:{root}", "status": root_status, "root_fault": True}])

    stamp = uuid.uuid4().hex[:6]  # unique per injection, even several in the same second
    alerts = [
        {"id": f"ALR-{stamp}-{i + 1}", "svc": svc, "metric": metric, "value": value, "threshold": threshold,
         "at": now - (3 - min(i, 2)) * MIN_MS}
        for i, (svc, metric, value, threshold) in enumerate(spec["alerts"])
    ]
    _fire(batch, alerts, name)
    batch.send(graph)
    return {
        "scenario": name,
        "title": spec["title"],
        "alerting_services": [a["svc"] for a in alerts],
        "alert_uids": [f"alert:{a['id']}" for a in alerts],
    }


TIER_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def team_handles(graph: Graph, service: str) -> list[str]:
    """Handles of the members of the team that owns a service, sorted."""
    teams = [e["to_id"] for e in graph.getEdges("Service", f"svc:{service}", "reverse_OWNS")]
    return sorted(e["to_id"].removeprefix("person:")
                  for t in teams for e in graph.getEdges("Team", t, "reverse_MEMBER_OF"))


def inject_chaos(service: str, mode: str = "down", with_deploy: bool = False, graph: Graph | None = None,
                 now: int | None = None) -> dict:
    """Break any service. Its most important direct callers start alerting. Nothing here is scripted:
    the agent has to work it out from the graph like any other incident."""
    graph = graph or get_graph()
    now = now or now_ms()
    if not attrs(graph, "Service", f"svc:{service}"):
        raise ValueError(f"unknown service {service!r}")
    mode = mode if mode in ("down", "degraded") else "down"
    soft_reset(graph)

    batch = Batch()
    deploy = None
    if with_deploy:
        rng = random.Random(f"{service}:{now // 60000}")
        author = [{"h": h} for h in team_handles(graph, service)]
        version = f"v9.{rng.randint(0, 9)}.{rng.randint(1, 9)}"
        message = rng.choice(CHAOS_CHANGES)
        _deploy(batch, service, version, rng.choice(author)["h"] if author else "dan", message, now - 4 * MIN_MS)
        deploy = {"version": version, "message": message}

    upsert(batch, "Service", [{"uid": f"svc:{service}", "status": mode, "root_fault": True}])
    caller_uids = [e["to_id"] for e in graph.getEdges("Service", f"svc:{service}", "reverse_DEPENDS_ON")]
    callers = [{"name": v["attributes"]["name"], "tier": v["attributes"]["tier"],
                "rev": v["attributes"]["revenue_per_min"]}
               for v in (graph.getVerticesById("Service", caller_uids) if caller_uids else [])]
    callers.sort(key=lambda c: (TIER_RANK.get(c["tier"], 9), -c["rev"], c["name"]))
    alerting = [c["name"] for c in callers[:3]] or [service]
    stamp = uuid.uuid4().hex[:6]
    metric = ("p99_latency_ms", 4200, 600) if mode == "degraded" else ("error_rate", 0.42, 0.02)
    alerts = [{"id": f"ALR-{stamp}-{i + 1}", "svc": name, "metric": metric[0], "value": metric[1],
               "threshold": metric[2], "at": now - (3 - min(i, 2)) * MIN_MS} for i, name in enumerate(alerting)]
    _fire(batch, alerts, "chaos", root=service)
    batch.send(graph)
    return {"scenario": "chaos", "title": f"Chaos: {service} {mode}", "target": service, "deploy": deploy,
            "alerting_services": alerting, "alert_uids": [f"alert:{a['id']}" for a in alerts]}


def reset(graph: Graph | None = None, keep_memory: bool = True) -> None:
    """Soft reset (keeps learned memory) or hard reset (re-seed everything)."""
    graph = graph or get_graph()
    if keep_memory and service_count(graph):
        soft_reset(graph)
    else:
        seed_baseline(graph)


# --- The sandbox shop: a real system, so a failure has to be real or the next trace window heals it ---

def sandbox_enabled() -> bool:
    return os.getenv("ACTION_ADAPTER", "").lower() == "sandbox"


def _shop(cmd: dict, timeout: float = 10) -> dict:
    url = os.getenv("SANDBOX_URL", "http://localhost:7499").rstrip("/")
    req = urllib.request.Request(f"{url}/__control", json.dumps(cmd).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def sandbox_reset(graph: Graph | None = None) -> None:
    """Heal the running shop (its faults, breakers and versions) and quiet the graph."""
    _shop({"action": "reset"})
    soft_reset(graph or get_graph())


def sandbox_chaos(service: str, mode: str = "down", with_deploy: bool = False, graph: Graph | None = None,
                  wait_s: float = 25) -> dict | None:
    """Break a service of the running sandbox shop, then wait until its traces have turned into alerts, so an
    investigation started right after sees the incident. None when the shop does not know the service (the
    caller falls back to a graph-only failure). Injecting only into the graph would be undone within seconds
    by the shop's healthy traces."""
    from ..tools.read import firing_alerts  # tools import this module's siblings

    graph = graph or get_graph()
    if not attrs(graph, "Service", f"svc:{service}"):
        raise ValueError(f"unknown service {service!r}")
    mode = mode if mode in ("down", "degraded") else "down"
    cmd: dict = {"action": "fault", "service": service, "rate": 1.0 if mode == "down" else 0.5}
    deploy = None
    if with_deploy:
        rng = random.Random(f"{service}:{now_ms() // 60000}")
        deploy = {"version": f"v9.{rng.randint(0, 9)}.{rng.randint(1, 9)}", "message": rng.choice(CHAOS_CHANGES),
                  "author": "Priya Shah"}
        cmd["deploy"] = deploy
    try:
        _shop({"action": "reset"})
        soft_reset(graph)
        _shop(cmd)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    deadline = time.monotonic() + wait_s
    alerting: list[str] = []
    while time.monotonic() < deadline:
        alerting = sorted({a["service"] for a in firing_alerts(graph)})
        if alerting:
            break
        time.sleep(1)
    return {"scenario": "chaos", "title": f"Chaos: {service} {mode}", "target": service, "deploy": deploy,
            "alerting_services": alerting, "alert_uids": []}
