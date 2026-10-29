"""Recovery by traversal: a symptom service is healthy again once nothing unhealthy is reachable below it.

"Reachable" follows DEPENDS_ON through *closed* breakers only. Opening the breakers into a failing
service isolates it, so its callers fall back and recover even before the root cause is fixed.
"""
from collections import defaultdict

from ..db import Graph, flat, run, upsert

HEALTH_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  MapAccum<STRING, SetAccum<STRING>> @@deps, @@alerts;
  S = {Service.*};
  X = SELECT s FROM S:s -(DEPENDS_ON>:e)- Service:t WHERE e.breaker != "open" ACCUM @@deps += (s.name -> t.name);
  A = {Alert.*};
  X = SELECT a FROM A:a -(FIRED_ON>)- Service:s WHERE a.status == "firing" ACCUM @@alerts += (s.name -> a.uid);
  PRINT S[S.name, S.status, S.root_fault], @@deps, @@alerts;
}
"""


def recompute_health(graph: Graph) -> dict:
    """Recover symptom services (the ones with firing alerts) whose dependencies are healthy again.

    Root causes (unhealthy services without their own alert) only recover through an action.
    Returns the recovered service uids and the resolved alert uids.
    """
    out = run(graph, HEALTH_GSQL, query_name="sentinel_health")
    found = flat(out["S"])
    status = {r["name"]: r["status"] for r in found}
    faulty = {r["name"] for r in found if r["root_fault"]}
    deps: dict[str, list[str]] = defaultdict(list, {k: sorted(v) for k, v in out["@@deps"].items()})
    alerts: dict[str, list[str]] = defaultdict(list, {k: sorted(v) for k, v in out["@@alerts"].items()})

    def unhealthy_below(name: str) -> bool:
        seen, stack = set(), list(deps[name])
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            if status.get(cur) != "healthy":
                return True
            stack.extend(deps[cur])
        return False

    recovered: list[str] = []
    changed = True
    while changed:
        changed = False
        for name in sorted(alerts):
            # A service with its own fault (the root cause) only recovers through an action.
            if status.get(name) != "healthy" and name not in faulty and not unhealthy_below(name):
                status[name] = "healthy"
                recovered.append(name)
                changed = True

    # Alerts resolve on every healthy service with nothing unhealthy below it, including a root that an
    # action fixed directly (e.g. an edge service alerting on itself).
    resolved = [uid for name in sorted(alerts) if status.get(name) == "healthy" and not unhealthy_below(name)
                for uid in alerts[name]]
    upsert(graph, "Service", [{"uid": f"svc:{n}", "status": "healthy"} for n in recovered])
    upsert(graph, "Alert", [{"uid": u, "status": "resolved"} for u in resolved])
    return {"recovered": [f"svc:{n}" for n in recovered], "resolved_alerts": resolved}
