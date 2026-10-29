"""Seed memory: past incidents, the actions that fixed them, and runbooks.

Memory lives in the same graph as the infrastructure, linked to the services it
touched, so recalling "have we seen this before?" is a traversal.
"""
from ..db import Batch, Graph, link, upsert
from .history import create_deployments, sha_for

DAY_MS = 24 * 60 * 60 * 1000
MIN_MS = 60 * 1000

RUNBOOKS = [
    {
        "slug": "db-pool-exhaustion",
        "title": "DB connection pool exhaustion",
        "steps": "1. Confirm p99 latency on callers of inventory-db-proxy. "
                 "2. Check recent deploys to the proxy for pool-size changes. "
                 "3. Roll back the deploy. 4. If still saturated, raise max pool size. "
                 "5. Page Platform on-call.",
        "services": ["inventory-db-proxy"],
    },
    {
        "slug": "feature-flag-rollback",
        "title": "Bad feature-flag / config push",
        "steps": "1. Diff the last flag push. 2. Roll back the feature-flags deploy. "
                 "3. Verify login success rate recovers.",
        "services": ["feature-flags", "config-service"],
    },
    {
        "slug": "cache-eviction-storm",
        "title": "Cache eviction storm / stampede",
        "steps": "1. Check redis-cache memory and eviction rate. 2. Open the circuit breaker on callers "
                 "so they fall back to the source of truth. 3. Scale up redis-cache. 4. Close breakers.",
        "services": ["redis-cache"],
    },
]

# Each past incident: who it hit, what caused it, and how it was fixed.
INCIDENTS = [
    {
        "id": "INC-0042",
        "title": "Checkout & cart timeouts",
        "severity": "SEV1",
        "age_days": 34,
        "minutes": 47,
        "summary": "Deploy v3.0.1 to inventory-db-proxy cut max pool size; callers queued for connections "
                   "and checkout p99 hit 9 s. Fixed by rollback plus a pool resize.",
        "steps_taken": 9,
        "affected": ["checkout-api", "cart-service", "inventory-service"],
        "root_cause": {"svc": "inventory-db-proxy", "version": "v3.0.1",
                       "message": "Lower max pool size to 20", "author": "dan"},
        "alerts": [("checkout-api", "p99_latency_ms", 9100, 800), ("cart-service", "p99_latency_ms", 6400, 600)],
        "actions": [("rollback", "dep"), ("page_oncall", "svc"), ("scale_up", "svc")],
        "runbook": "db-pool-exhaustion",
    },
    {
        "id": "INC-0057",
        "title": "Login latency spike",
        "severity": "SEV2",
        "age_days": 21,
        "minutes": 22,
        "summary": "A feature-flags push enabled an expensive token check for all users; auth p99 tripled. "
                   "Fixed by rolling back the flag push.",
        "steps_taken": 6,
        "affected": ["auth-service", "user-profile"],
        "root_cause": {"svc": "feature-flags", "version": "v2.9.1",
                       "message": "Enable strict-token-check for 100% of users", "author": "eva"},
        "alerts": [("auth-service", "p99_latency_ms", 2400, 500)],
        "actions": [("rollback", "dep")],
        "runbook": "feature-flag-rollback",
    },
    {
        "id": "INC-0063",
        "title": "Search degraded",
        "severity": "SEV2",
        "age_days": 9,
        "minutes": 31,
        "summary": "redis-cache hit maxmemory and started an eviction storm; search and recommendations "
                   "hammered their databases. Fixed by opening breakers and scaling the cache.",
        "steps_taken": 7,
        "affected": ["search-service", "recommendations"],
        "root_cause": {"svc": "redis-cache"},
        "alerts": [("search-service", "error_rate", 0.18, 0.02)],
        "actions": [("open_breaker", "svc"), ("scale_up", "svc")],
        "runbook": "cache-eviction-storm",
    },
]

SIMILAR = [("INC-0042", "INC-0063", 0.6, "both: shared platform dependency saturated, callers timed out")]


def build_runbooks(graph: Graph | Batch) -> None:
    upsert(graph, "Runbook", [{"uid": f"rb:{r['slug']}", "title": r["title"], "steps": r["steps"]} for r in RUNBOOKS])
    link(graph, "Runbook", "APPLIES_TO", "Service", [(f"rb:{r['slug']}", f"svc:{name}")
                                                     for r in RUNBOOKS for name in r["services"]])


def build_incident(graph: Graph | Batch, inc: dict, now: int) -> None:
    opened = now - inc["age_days"] * DAY_MS
    resolved = opened + inc["minutes"] * MIN_MS
    uid = f"inc:{inc['id']}"
    upsert(graph, "Incident", [{"uid": uid, "id": inc["id"], "title": inc["title"], "severity": inc["severity"],
                                "status": "resolved", "opened_at": opened, "resolved_at": resolved,
                                "summary": inc["summary"], "steps_taken": inc["steps_taken"]}])
    link(graph, "Incident", "AFFECTED", "Service", [(uid, f"svc:{name}") for name in inc["affected"]])

    rc = inc["root_cause"]
    target_uid, target_type = f"svc:{rc['svc']}", "Service"
    if "version" in rc:
        # The bad deploy was rolled back, so it stays in history with that status.
        create_deployments(graph, [{
            "svc": rc["svc"], "version": rc["version"], "at": opened - 6 * MIN_MS,
            "summary": rc["message"], "sha": sha_for(rc["svc"], rc["version"]), "message": rc["message"],
            "files": 2, "author": rc["author"],
        }], status="rolled_back")
        target_uid, target_type = f"dep:{rc['svc']}:{rc['version']}", "Deployment"
    link(graph, "Incident", "ROOT_CAUSE", target_type, [(uid, target_uid)])

    alerts = [{"uid": f"alert:{inc['id']}-A{n}", "id": f"{inc['id']}-A{n}", "metric": metric, "value": value,
               "threshold": threshold, "at": opened, "status": "resolved", "svc": svc}
              for n, (svc, metric, value, threshold) in enumerate(inc["alerts"], start=1)]
    upsert(graph, "Alert", [{k: v for k, v in a.items() if k != "svc"} for a in alerts])
    link(graph, "Incident", "TRIGGERED_BY", "Alert", [(uid, a["uid"]) for a in alerts])
    link(graph, "Alert", "FIRED_ON", "Service", [(a["uid"], f"svc:{a['svc']}") for a in alerts])

    actions = [{"uid": f"act:{inc['id']}-{n}", "kind": kind, "status": "executed", "reason": "past incident",
                "risk": "low", "created_at": resolved, "executed_at": resolved, "approved_by": "on-call",
                "on": on} for n, (kind, on) in enumerate(inc["actions"], start=1)]
    upsert(graph, "Action", [{k: v for k, v in a.items() if k != "on"} for a in actions])
    link(graph, "Incident", "RESOLVED_BY", "Action", [(uid, a["uid"]) for a in actions])
    for a in actions:
        on_dep = a["on"] == "dep"
        link(graph, "Action", "TARGETS", target_type if on_dep else "Service",
             [(a["uid"], target_uid if on_dep else f"svc:{rc['svc']}")])

    link(graph, "Incident", "FOLLOWED", "Runbook", [(uid, f"rb:{inc['runbook']}")])


def build_memory(graph: Graph | Batch, now: int) -> None:
    build_runbooks(graph)
    for inc in INCIDENTS:
        build_incident(graph, inc, now)
    link(graph, "Incident", "SIMILAR_TO", "Incident", [(f"inc:{a}", f"inc:{b}", {"score": s, "reason": why})
                                                       for a, b, s, why in SIMILAR])
