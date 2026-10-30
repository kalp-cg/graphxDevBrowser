"""Read models for the UI: the graph to draw and the incident list."""
from typing import Any

from ..db import Graph, get_graph, run
from ..schema import FORWARD_EDGES
from ..tools.algorithms import BETWEENNESS_GSQL, PAGERANK_GSQL, scores
from ..tools.common import now_ms
from ..tools.memory import incidents

RECENT_MS = 2 * 60 * 60 * 1000

# The whole graph in one round trip: every vertex and every (forward) edge. It's a few hundred vertices.
SNAPSHOT_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  ListAccum<EDGE> @@edges;
  All = {ANY};
  X = SELECT s FROM All:s -(({FORWARD}):e)- :t ACCUM @@edges += e;
  PRINT All, @@edges;
}
""".replace("{FORWARD}", FORWARD_EDGES)

KEEP = ("name", "status", "tier", "layer", "language", "version", "at", "change_summary", "message", "sha",
        "metric", "value", "threshold", "id", "title", "severity", "summary", "steps_taken", "kind", "target",
        "reason", "risk", "outcome", "role", "handle", "engine", "size_gb", "learned", "root_cause_service",
        "revenue_per_min", "root_fault")

# PageRank and betweenness depend only on the DEPENDS_ON topology, which rarely changes: cache by topology.
_centrality: dict[frozenset, dict[str, dict[str, float]]] = {}


def _label(n: dict, t: str) -> str:
    if t == "Deployment":
        return f"{n['uid'].split(':')[1]} {n.get('version', '')}"
    if t == "Commit":
        return (n.get("message") or n.get("sha", ""))[:40]
    if t == "Alert":
        return f"{n.get('metric')} {n.get('value')}"
    if t == "Incident":
        return n.get("id", "")
    if t == "Action":
        return f"{n.get('kind')} {n.get('target')}"
    if t == "Runbook":
        return n.get("title", "")
    if t == "Page":
        return "page"
    return n.get("name", n["uid"])


def centrality(g: Graph, topology: frozenset) -> dict[str, dict[str, float]]:
    """uid -> {pagerank, betweenness}, recomputed only when DEPENDS_ON changes."""
    if topology not in _centrality:
        out: dict[str, dict[str, float]] = {}
        for metric, gsql in (("pagerank", PAGERANK_GSQL), ("betweenness", BETWEENNESS_GSQL)):
            for r in scores(g, gsql):
                out.setdefault(r["uid"], {})[metric] = round(float(r["score"]), 4)
        _centrality.clear()
        _centrality[topology] = out
    return _centrality[topology]


def _pick(vertices: dict[str, dict], edges: list[dict], now: int) -> dict[str, tuple[str, str | None]]:
    """Which nodes the UI draws (uid -> (type, team)). Infrastructure always; context nodes only when they
    matter right now."""
    since = now - RECENT_MS
    out_edges: dict[str, list[dict]] = {}
    for e in edges:
        out_edges.setdefault(e["from_id"], []).append(e)

    def targets(uid: str, etype: str) -> list[str]:
        return [e["to_id"] for e in out_edges.get(uid, []) if e["e_type"] == etype]

    owner = {e["to_id"]: vertices[e["from_id"]]["name"] for e in edges if e["e_type"] == "OWNS"}
    member = {e["from_id"]: vertices[e["to_id"]]["name"] for e in edges if e["e_type"] == "MEMBER_OF"}
    of_type = lambda t: sorted(u for u, v in vertices.items() if v["_type"] == t)  # noqa: E731
    recent_deps = [d for d in of_type("Deployment") if vertices[d]["at"] >= since]

    picked: dict[str, tuple[str, str | None]] = {}

    def add(uid: str, t: str, team: str | None) -> None:
        picked.setdefault(uid, (t, team))

    # A database scanned from a repository is a Service of kind `database` (so it can fail and be a root cause);
    # it is drawn as a database, and its plain Database twin (which carries read/write edges) is not drawn twice.
    db_services = {v["name"] for v in vertices.values() if v["_type"] == "Service" and v.get("kind") == "database"}
    for t in ("Service", "Database"):
        for u in of_type(t):
            if t == "Database" and vertices[u]["name"] in db_services:
                continue
            add(u, "Database" if vertices[u].get("kind") == "database" else t, owner.get(u))
    for u in of_type("Team"):
        add(u, "Team", vertices[u]["name"])
    # On-call people, plus authors of recent changes.
    for e in edges:
        if e["e_type"] == "ON_CALL" and e["attributes"]["from_ms"] <= now < e["attributes"]["to_ms"]:
            add(e["from_id"], "Person", vertices[e["to_id"]]["name"])
    for d in recent_deps:
        for c in targets(d, "CONTAINS"):
            for p in targets(c, "AUTHORED_BY"):
                add(p, "Person", member.get(p))
    # Recent deployments and their commits, plus deployments that incidents blame.
    for d in recent_deps:
        add(d, "Deployment", None)
    for e in edges:
        if e["e_type"] == "ROOT_CAUSE" and vertices[e["to_id"]]["_type"] == "Deployment":
            add(e["to_id"], "Deployment", None)
    for d in recent_deps:
        for c in targets(d, "CONTAINS"):
            add(c, "Commit", None)
    for u in of_type("Alert"):
        if vertices[u]["status"] == "firing":
            add(u, "Alert", None)
    for t in ("Incident", "Runbook"):
        for u in of_type(t):
            add(u, t, None)
    for u in of_type("Action"):
        if vertices[u]["status"] == "pending" or vertices[u]["created_at"] >= since:
            add(u, "Action", None)
    for u in of_type("Page"):
        if vertices[u]["at"] >= since:
            add(u, "Page", None)
    return picked


def graph_snapshot() -> dict[str, Any]:
    g = get_graph()
    now = now_ms()
    out = run(g, SNAPSHOT_GSQL)
    vertices = {v["v_id"]: {**v["attributes"], "uid": v["v_id"], "_type": v["v_type"]} for v in out["All"]}
    for v in vertices.values():
        if v["_type"] == "Action":
            v["target"] = v.get("target_name")
    edges = out["@@edges"]

    nodes: dict[str, dict] = {}
    for uid, (t, team) in _pick(vertices, edges, now).items():
        p = vertices[uid]
        # `id` is the graph key (the uid); a node's own id property (INC-0042, ALR-...) becomes `ref`.
        props = {("ref" if k == "id" else k): p[k] for k in KEEP if k in p}
        nodes[uid] = {**props, "id": uid, "type": t, "label": _label(p, t), "team": team}

    topology = frozenset((e["from_id"], e["to_id"]) for e in edges if e["e_type"] == "DEPENDS_ON")
    for uid, metrics in centrality(g, topology).items():
        if uid in nodes:
            nodes[uid].update(metrics)

    links = []
    for e in edges:
        s, t, a = e["from_id"], e["to_id"], e["attributes"]
        if e["e_type"] == "MEMBER_OF" or s not in nodes or t not in nodes:
            continue
        links.append({"id": a.get("uid") or f"{e['e_type']}:{s}->{t}", "source": s, "target": t,
                      "type": e["e_type"], **({"breaker": a["breaker"]} if a.get("breaker") else {})})
    return {"nodes": list(nodes.values()), "links": links, "at": now}


def incidents_view() -> list[dict]:
    out = []
    for i in incidents(get_graph()):
        out.append({
            "uid": i["uid"], "id": i["id"], "title": i["title"], "status": i["status"], "severity": i["severity"],
            "summary": i["summary"], "steps_taken": i["steps_taken"], "opened_at": i["opened_at"],
            "resolved_at": i["resolved_at"] or None, "learned": bool(i["learned"]),
            "root_cause_uid": i["root_cause_uid"], "root_cause_service": i["root_cause_service"],
            "actions": [{"kind": k, "status": st} for k, st in (a.split("|", 1) for a in sorted(i["actions"]))],
            "similar_to": sorted(i["similar_out"]), "affected": sorted(i["affected"]),
        })
    return sorted(out, key=lambda r: -r["opened_at"])
