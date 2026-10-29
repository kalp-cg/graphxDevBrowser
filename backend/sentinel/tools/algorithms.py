"""Graph algorithm tools (GSQL), used to explain *why* a failure matters."""
from ..db import Graph, flat, run
from .common import check_services, graph_or_default, clamp, result
from .read import path_edges, reach, reach_gsql

# PageRank over DEPENDS_ON (damping 0.85): rank flows from callers to the services they depend on.
# Scores are normalized to sum to 1.
PAGERANK_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  MaxAccum<DOUBLE> @@diff = 9999;
  SumAccum<DOUBLE> @@total;
  SumAccum<DOUBLE> @received, @next;
  SumAccum<DOUBLE> @score = 1;
  SumAccum<INT> @out;
  S = {Service.*};
  X = SELECT s FROM S:s -(DEPENDS_ON>)- Service:t ACCUM s.@out += 1;
  WHILE @@diff > 0.0001 LIMIT 50 DO
    @@diff = 0;
    X = SELECT t FROM S:s -(DEPENDS_ON>)- Service:t ACCUM t.@received += s.@score / s.@out;
    S = SELECT s FROM S:s POST-ACCUM s.@next = 0.15 + 0.85 * s.@received, s.@received = 0;
    S = SELECT s FROM S:s POST-ACCUM @@diff += abs(s.@next - s.@score);
    S = SELECT s FROM S:s POST-ACCUM s.@score = s.@next;
  END;
  S = SELECT s FROM S:s POST-ACCUM @@total += s.@score;
  S = SELECT s FROM S:s POST-ACCUM s.@score = s.@score / @@total;
  PRINT S[S.name, S.tier, S.status, S.@score];
}
"""

# Betweenness centrality (Brandes), every source at once: a forward BFS counts shortest paths per source
# (sigma), then dependencies (delta) flow back layer by layer. score(v) = sum of delta over sources != v.
BETWEENNESS_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  MapAccum<VERTEX, MinAccum<INT>> @dist, @nd;
  MapAccum<VERTEX, SumAccum<DOUBLE>> @sigma, @ns, @delta;
  SumAccum<DOUBLE> @score;
  OrAccum @changed;
  INT k = 0;
  All = {Service.*};
  F = SELECT s FROM All:s POST-ACCUM s.@dist += (s -> 0), s.@sigma += (s -> 1.0);
  WHILE F.size() > 0 DO
    k = k + 1;
    F = SELECT t FROM F:s -(DEPENDS_ON>)- Service:t
        ACCUM FOREACH (src, d) IN s.@dist DO
                IF d == k - 1 AND NOT t.@dist.containsKey(src) THEN
                  t.@nd += (src -> k), t.@ns += (src -> s.@sigma.get(src))
                END
              END
        POST-ACCUM t.@changed = t.@nd.size() > 0, t.@dist += t.@nd, t.@sigma += t.@ns, t.@nd.clear(), t.@ns.clear()
        HAVING t.@changed;
  END;
  WHILE k > 1 DO
    k = k - 1;
    X = SELECT v FROM All:v -(DEPENDS_ON>)- Service:w
        ACCUM FOREACH (src, dw) IN w.@dist DO
                IF dw == k AND v.@dist.containsKey(src) AND v.@dist.get(src) == k - 1 THEN
                  v.@delta += (src -> v.@sigma.get(src) / w.@sigma.get(src) * (1 + w.@delta.get(src)))
                END
              END;
  END;
  All = SELECT v FROM All:v
        POST-ACCUM FOREACH (src, x) IN v.@delta DO IF src != v THEN v.@score += x END END;
  PRINT All[All.name, All.tier, All.status, All.@score];
}
"""


def scores(g: Graph, gsql: str, query_name: str | None = None) -> list[dict]:
    """Every service with its score, highest first."""
    out = run(g, gsql, query_name=query_name)
    found = flat(next(iter(out.values())))
    return sorted(found, key=lambda r: (-r["score"], r["name"]))


def _ranked(g: Graph, gsql: str, top: int, focus: str | None,
            query_name: str | None = None) -> tuple[list[dict], dict | None]:
    ranked = [{k: r[k] for k in ("name", "uid", "tier", "status", "score")} for r in scores(g, gsql, query_name=query_name)]
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i
        r["score"] = round(float(r["score"]), 4)
    hit = next((r for r in ranked if r["name"] == focus), None) if focus else None
    if hit:
        hit = {**hit, "out_of": len(ranked)}
    return ranked[:top], hit


def critical_services(top: int = 10, service: str | None = None, graph: Graph | None = None) -> dict:
    """PageRank over DEPENDS_ON: rank flows to the services the most things depend on.

    Pass `service` to also get that service's rank.
    """
    g = graph_or_default(graph)
    if service and (err := check_services(g, [service])):
        return err
    n = clamp(top, 1, 25, 10)
    items, focus = _ranked(g, PAGERANK_GSQL, n, service, query_name="sentinel_pagerank")
    return result({"algorithm": "pageRank", "top": items, "focus": focus}, PAGERANK_GSQL,
                  [r["uid"] for r in items] + ([focus["uid"]] if focus else []))


def chokepoints(top: int = 10, service: str | None = None, graph: Graph | None = None) -> dict:
    """Betweenness centrality: services that sit on the most dependency paths (single points of failure)."""
    g = graph_or_default(graph)
    if service and (err := check_services(g, [service])):
        return err
    n = clamp(top, 1, 25, 10)
    items, focus = _ranked(g, BETWEENNESS_GSQL, n, service, query_name="sentinel_betweenness")
    return result({"algorithm": "betweenness", "top": items, "focus": focus}, BETWEENNESS_GSQL,
                  [r["uid"] for r in items] + ([focus["uid"]] if focus else []))


def failure_path(from_service: str, to_service: str, graph: Graph | None = None) -> dict:
    """Shortest DEPENDS_ON path from a caller to a failing dependency: how the failure propagates."""
    g = graph_or_default(graph)
    if err := check_services(g, [from_service, to_service]):
        return err
    found = reach(g, [from_service], "down", 100)
    gsql = reach_gsql("down")
    if to_service not in found or to_service == from_service:
        return result({"from": from_service, "to": to_service, "path": None,
                       "message": f"{from_service} does not depend on {to_service}"},
                      gsql, [f"svc:{from_service}", f"svc:{to_service}"])
    edges = path_edges(found, from_service, to_service, "down")
    names = [from_service] + [e.split("->")[1] for e in edges]
    hops = [{"name": n, "uid": found[n]["uid"], "status": found[n]["status"]} for n in names]
    return result({"from": from_service, "to": to_service, "hops": len(edges), "path": hops},
                  gsql, [h["uid"] for h in hops], edges)
