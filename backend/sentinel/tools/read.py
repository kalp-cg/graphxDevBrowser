"""Read / traversal tools. All values from the agent go in as query parameters."""
from ..db import Graph, flat, run
from .common import capped, check_services, clamp, graph_or_default, now_ms, result

CONTEXT_GSQL = """
INTERPRET QUERY (STRING service, INT now) FOR GRAPH $graphname SYNTAX v2 {
  S = {Service.*};
  S = SELECT s FROM S:s WHERE s.name == service;
  T = SELECT t FROM S:s -(<OWNS)- Team:t;
  P = SELECT p FROM T:t -(<ON_CALL:e)- Person:p WHERE e.from_ms <= now AND e.to_ms > now;
  D = SELECT d FROM S:s -(READS_FROM>|WRITES_TO>)- Database:d;
  R = SELECT d FROM S:s -(<DEPLOYED_TO)- Deployment:d ORDER BY d.at DESC LIMIT 3;
  PRINT S, T, P, D, R;
}
"""


def service_context(g: Graph, service: str) -> dict:
    """The raw context of a service: service, team, on-call people, databases, last 3 deploys (newest first)."""
    out = run(g, CONTEXT_GSQL, {"service": service, "now": now_ms()}, query_name="sentinel_service_context")
    team = flat(out["T"])
    return {"service": flat(out["S"])[0], "team": team[0] if team else {},
            "on_call": sorted(flat(out["P"]), key=lambda p: p["uid"]),
            "databases": sorted(flat(out["D"]), key=lambda d: d["uid"]),
            "deploys": sorted(flat(out["R"]), key=lambda d: -d["at"])}


def get_service_context(service: str, graph: Graph | None = None) -> dict:
    """Owner team, current on-call, tier/status, databases and the last 3 deployments of a service."""
    g = graph_or_default(graph)
    if err := check_services(g, [service]):
        return err
    ctx = service_context(g, service)
    s, t, oncall, dbs, deploys = ctx["service"], ctx["team"], ctx["on_call"], ctx["databases"], ctx["deploys"]
    value = {
        "service": {k: s.get(k) for k in ("name", "uid", "tier", "status", "layer", "language", "version")},
        "team": t.get("name"),
        "slack_channel": t.get("slack_channel"),
        "on_call": [{"name": p["name"], "handle": p["handle"], "uid": p["uid"]} for p in oncall],
        "databases": [{"name": d["name"], "engine": d["engine"], "uid": d["uid"]} for d in dbs],
        "recent_deployments": [
            {"uid": d["uid"], "version": d["version"], "at": d["at"], "status": d["status"],
             "change_summary": d["change_summary"]}
            for d in deploys
        ],
    }
    uids = [s["uid"], t.get("uid")] + [p["uid"] for p in oncall] + [d["uid"] for d in dbs] + [d["uid"] for d in deploys]
    return result(value, CONTEXT_GSQL, [u for u in uids if u])


ALERTS_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  MinAccum<STRING> @service, @service_uid, @service_status;
  A = {Alert.*};
  A = SELECT a FROM A:a -(FIRED_ON>)- Service:s WHERE a.status == "firing"
      ACCUM a.@service += s.name, a.@service_uid += s.uid, a.@service_status += s.status;
  PRINT A[A.id, A.metric, A.value, A.threshold, A.at, A.@service, A.@service_uid, A.@service_status];
}
"""


def firing_alerts(g: Graph) -> list[dict]:
    return sorted(flat(run(g, ALERTS_GSQL, query_name="sentinel_active_alerts")["A"]), key=lambda a: (a["at"], a["uid"]))


def get_active_alerts(graph: Graph | None = None) -> dict:
    """Every alert that is currently firing, oldest first, with the service it fired on."""
    g = graph_or_default(graph)
    alerts = firing_alerts(g)
    uids = [u for a in alerts for u in (a["uid"], a["service_uid"])]
    return result(alerts, ALERTS_GSQL, uids)


# Multi-source breadth-first search over DEPENDS_ON. For every service reached it records, per source, the hop
# count and the edge it was first reached through (the smallest edge uid among equally short ones), so a
# shortest path back to each source can be rebuilt. {EDGE} is DEPENDS_ON> (downstream) or <DEPENDS_ON (upstream).
REACH_GSQL = """
INTERPRET QUERY (SET<STRING> sources, INT depth) FOR GRAPH $graphname SYNTAX v2 {
  MapAccum<STRING, MinAccum<INT>> @dist, @nd;
  MapAccum<STRING, MinAccum<STRING>> @via, @nv;
  OrAccum @changed;
  INT hop = 0;
  F = {Service.*};
  F = SELECT s FROM F:s WHERE s.name IN sources POST-ACCUM s.@dist += (s.name -> 0);
  R = F;
  WHILE F.size() > 0 AND hop < depth DO
    hop = hop + 1;
    F = SELECT t FROM F:s -({EDGE}:e)- Service:t
        ACCUM FOREACH (src, d) IN s.@dist DO
                IF d == hop - 1 AND NOT t.@dist.containsKey(src) THEN
                  t.@nd += (src -> hop), t.@nv += (src -> e.uid)
                END
              END
        POST-ACCUM t.@changed = t.@nd.size() > 0, t.@dist += t.@nd, t.@via += t.@nv, t.@nd.clear(), t.@nv.clear()
        HAVING t.@changed;
    R = R UNION F;
  END;
  PRINT R[R.name, R.status, R.tier, R.@dist, R.@via];
}
"""
DIRECTIONS = {"down": "DEPENDS_ON>", "up": "<DEPENDS_ON"}


def reach_gsql(direction: str) -> str:
    return REACH_GSQL.replace("{EDGE}", DIRECTIONS[direction])


def reach(g: Graph, sources: list[str], direction: str, depth: int) -> dict[str, dict]:
    """Services reachable from `sources` within `depth` hops: name -> {uid, status, tier, dist, via}.

    `dist` and `via` are keyed by source name; a source reaches itself at 0 hops.
    """
    out = run(g, reach_gsql(direction), {"sources": list(sources), "depth": depth})
    return {r["name"]: r for r in flat(out["R"])}


def path_edges(found: dict[str, dict], source: str, target: str, direction: str) -> list[str]:
    """Edge uids of the shortest path from `source` to `target`, rebuilt from the BFS `via` edges."""
    edges, cur = [], target
    while cur != source:
        e = found[cur]["via"][source]
        edges.append(e)
        caller, callee = e.removeprefix("e:").split("->")
        cur = caller if direction == "down" else callee
    return edges[::-1]


def _hops(g: Graph, service: str, direction: str, depth: int) -> tuple[list[dict], list[str]]:
    """One row per service reachable from `service` (nearest first) plus the edge uids on their paths."""
    found = reach(g, [service], direction, depth)
    rows, edges = [], []
    for name, r in found.items():
        if name == service:
            continue
        rows.append({"name": name, "uid": r["uid"], "status": r["status"], "tier": r["tier"],
                     "hops": r["dist"][service]})
        edges += path_edges(found, service, name, direction)
    rows.sort(key=lambda r: (r["hops"], r["name"]))
    return rows, edges


def trace_dependencies(service: str, depth: int = 3, graph: Graph | None = None) -> dict:
    """Everything a service depends on, directly or transitively (downstream), nearest first."""
    g = graph_or_default(graph)
    if err := check_services(g, [service]):
        return err
    d = clamp(depth, 1, 6, 3)
    found, edges = _hops(g, service, "down", d)
    items, truncated = capped(found)
    return result(
        {"service": service, "depth": d, "dependencies": items, "count": len(found)},
        reach_gsql("down"), [f"svc:{service}"] + [r["uid"] for r in found], edges, truncated=truncated,
    )


def blast_radius(service: str, depth: int = 6, graph: Graph | None = None) -> dict:
    """Everything that breaks if this service fails (upstream callers), with a count per tier."""
    g = graph_or_default(graph)
    if err := check_services(g, [service]):
        return err
    d = clamp(depth, 1, 6, 6)
    found, edges = _hops(g, service, "up", d)
    by_tier: dict[str, int] = {}
    for r in found:
        by_tier[r["tier"]] = by_tier.get(r["tier"], 0) + 1
    items, truncated = capped(found)
    return result(
        {"service": service, "depth": d, "impacted": items, "count": len(found), "by_tier": by_tier},
        reach_gsql("up"), [f"svc:{service}"] + [r["uid"] for r in found], edges, truncated=truncated,
    )
