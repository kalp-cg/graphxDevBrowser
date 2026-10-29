"""Deterministic baseline graph: same input, same uids, every time (seed 42)."""
import random
import time

from ..db import Batch, Graph, get_graph, link, run, upsert
from ..schema import FORWARD_EDGES, ensure_schema
from .catalog import DATA_ACCESS, DATABASES, OBSERVABILITY, ON_CALL, PEOPLE, REVENUE_PER_MIN, SERVICES, TEAMS
from .history import build_history
from .memory import build_memory

SEED = 42
DAY_MS = 24 * 60 * 60 * 1000
PROTOCOLS = ["grpc", "http", "grpc", "tcp"]


def now_ms() -> int:
    return int(time.time() * 1000)


WIPE_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname {
  All = {ANY};
  All = SELECT s FROM All:s ACCUM DELETE (s);
  PRINT All.size() AS deleted;
}
"""

COUNTS_GSQL = """
INTERPRET QUERY () FOR GRAPH $graphname SYNTAX v2 {
  SumAccum<INT> @@edges;
  All = {ANY};
  X = SELECT s FROM All:s -(({FORWARD}):e)- :t ACCUM @@edges += 1;
  PRINT All.size() AS nodes, @@edges AS edges;
}
""".replace("{FORWARD}", FORWARD_EDGES)


def wipe(graph: Graph) -> None:
    """Delete every vertex (and so every edge) of this graph. The schema stays; other graphs are untouched."""
    run(graph, WIPE_GSQL)


def dependency_edges(rng: random.Random) -> list[tuple[str, str]]:
    """Hand-picked edges plus observability edges for business services.

    Asserts the DAG rule from catalog.py: a service only depends on services listed after it.
    """
    order = {name: i for i, (name, *_rest) in enumerate(SERVICES)}
    edges: list[tuple[str, str]] = []
    for name, _team, _tier, layer, _lang, deps in SERVICES:
        targets = list(deps)
        if layer == "business":
            # Not every service ships metrics/logs through the pipeline; pick deterministically.
            targets += [o for o in OBSERVABILITY if rng.random() < 0.5]
        for dep in targets:
            assert dep in order, f"{name} depends on unknown service {dep}"
            assert order[dep] > order[name], f"cycle risk: {name} -> {dep}"
            edges.append((name, dep))
    return edges


def refresh_on_call(graph: Graph, now: int | None = None) -> int:
    """Re-centre every on-call window on `now`, so paging keeps working however old the seed is.

    The baseline gives each window [seed - 1 day, seed + 30 days]; without this, a long-lived graph runs out
    of on-call engineers. Returns how many windows were updated.
    """
    return run(graph, REFRESH_ON_CALL_GSQL, on_call_window(now))["@@n"]


def on_call_window(now: int | None = None) -> dict[str, int]:
    now = now or now_ms()
    return {"from_ms": now - DAY_MS, "to_ms": now + 30 * DAY_MS}


REFRESH_ON_CALL_GSQL = """
INTERPRET QUERY (INT from_ms, INT to_ms) FOR GRAPH $graphname SYNTAX v2 {
  SumAccum<INT> @@n;
  P = {Person.*};
  X = SELECT p FROM P:p -(ON_CALL>:e)- Team:t ACCUM e.from_ms = from_ms, e.to_ms = to_ms, @@n += 1;
  PRINT @@n;
}
"""


def build_topology(graph: Graph | Batch, rng: random.Random, now: int) -> None:
    upsert(graph, "Team", [{"uid": f"team:{s}", "name": n, "domain": d, "slack_channel": f"#team-{s}"}
                           for s, n, d in TEAMS])
    upsert(graph, "Person", [{"uid": f"person:{h}", "handle": h, "name": n, "role": r} for h, n, r, _t in PEOPLE])
    link(graph, "Person", "MEMBER_OF", "Team", [(f"person:{h}", f"team:{t}") for h, _n, _r, t in PEOPLE])
    link(graph, "Person", "ON_CALL", "Team", [(f"person:{h}", f"team:{t}", {"from_ms": now - DAY_MS,
                                                                          "to_ms": now + 30 * DAY_MS})
                                              for t, h in sorted(ON_CALL.items())])
    upsert(graph, "Service", [
        {"uid": f"svc:{n}", "name": n, "tier": tier, "layer": layer, "language": lang, "kind": "service",
         "version": f"v{rng.randint(1, 5)}.{rng.randint(0, 9)}.{rng.randint(0, 9)}", "status": "healthy",
         "root_fault": False, "revenue_per_min": REVENUE_PER_MIN.get(n, 0)}
        for n, _t, tier, layer, lang, _deps in SERVICES
    ])
    link(graph, "Team", "OWNS", "Service", [(f"team:{t}", f"svc:{n}") for n, t, *_ in SERVICES])
    link(graph, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": rng.choice(PROTOCOLS), "weight": 1,
                                  "latency_ms": rng.randint(2, 40), "breaker": "closed"})
        for a, b in dependency_edges(rng)
    ])
    upsert(graph, "Database", [{"uid": f"db:{n}", "name": n, "engine": e, "size_gb": s, "status": "healthy"}
                               for n, e, s, _t in DATABASES])
    link(graph, "Team", "OWNS", "Database", [(f"team:{t}", f"db:{n}") for n, _e, _s, t in DATABASES])
    for rel in ("READS_FROM", "WRITES_TO"):
        link(graph, "Service", rel, "Database", [(f"svc:{s}", f"db:{d}", {"uid": f"e:{s}-{rel.lower()}->{d}"})
                                                 for s, d, kind in DATA_ACCESS if kind == rel])


def counts(graph: Graph) -> dict[str, int]:
    """Vertex and edge totals (each edge once, not its reverse edge)."""
    out = run(graph, COUNTS_GSQL)
    return {"nodes": out["nodes"], "edges": out["edges"]}


def seed_baseline(graph: Graph | None = None, now: int | None = None) -> dict[str, int]:
    """Wipe the graph and rebuild the healthy baseline. Returns node/edge counts."""
    graph = graph or get_graph()
    now = now or now_ms()
    rng = random.Random(SEED)
    ensure_schema(graph)
    wipe(graph)
    batch = Batch()
    build_topology(batch, rng, now)
    build_history(batch, rng, now)
    build_memory(batch, now)
    batch.send(graph)
    return counts(graph)
