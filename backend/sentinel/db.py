"""Graph access helpers.

The graph is the embedded, file-backed engine in localgraph.py: no server, no account, the whole product runs on
one laptop. Its API is a small set of upsert/read calls plus named graph queries (written in GSQL, executed as
Python with the same semantics).
"""
import threading
from pathlib import Path
from typing import Any

from .config import settings
from .localgraph import LocalGraph

Graph = LocalGraph

_lock = threading.Lock()
_conns: dict[str, Graph] = {}


def get_graph(name: str | None = None) -> Graph:
    name = name or settings.graph_name
    with _lock:
        conn = _conns.get(name)
        if conn is None:
            conn = _conns[name] = LocalGraph(name, Path(settings.local_graph_dir) / f"{name}.json")
    return conn


def run(graph: Graph, gsql: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run a graph query; returns everything it PRINTs, merged into one dict."""
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}
    out: dict[str, Any] = {}
    for printed in graph.runInterpretedQuery(gsql, clean_params):
        out.update(printed)
    return out


def flat(vertices: list[dict]) -> list[dict[str, Any]]:
    """A PRINTed vertex set as plain dicts: `S.name` / `S.@acc` / `name` all become `name` / `acc`."""
    rows = []
    for v in vertices or []:
        row = {"uid": v["v_id"]}
        for k, val in v["attributes"].items():
            row[k.split(".", 1)[-1].lstrip("@")] = val
        rows.append(row)
    return rows


def attrs(graph: Graph, vertex_type: str, uid: str) -> dict[str, Any] | None:
    """One vertex's attributes by uid, or None."""
    found = graph.getVerticesById(vertex_type, uid)
    return {"uid": found[0]["v_id"], **found[0]["attributes"]} if found else None


def upsert(graph: "Graph | Batch", vertex_type: str, rows: list[dict[str, Any]]) -> None:
    """Create or update vertices; each row needs a `uid`, other keys are attributes (only those change)."""
    if rows:
        graph.upsertVertices(vertex_type, [(r["uid"], {k: v for k, v in r.items() if k != "uid"}) for r in rows])


def link(graph: "Graph | Batch", src_type: str, edge: str, dst_type: str,
         pairs: list[tuple[str, str] | tuple[str, str, dict[str, Any]]]) -> None:
    """Create or update edges between existing vertices: (src_uid, dst_uid[, attributes])."""
    if pairs:
        graph.upsertEdges(src_type, edge, dst_type, [(p[0], p[1], p[2] if len(p) > 2 else {}) for p in pairs],
                          vertexMustExist=True)


class Batch:
    """Collects upserts (same calls as a connection, so `upsert` / `link` accept it) and writes them in one
    transaction (one lock and one file write instead of hundreds)."""

    def __init__(self) -> None:
        self.vertices: dict[str, dict] = {}
        self.edges: dict[str, dict] = {}

    def upsertVertices(self, vertex_type: str, vertices: list) -> None:  # noqa: N802 - mirrors pyTigerGraph
        for uid, values in vertices:
            row = self.vertices.setdefault(vertex_type, {}).setdefault(uid, {})
            row.update({k: {"value": v} for k, v in values.items()})

    def upsertEdges(self, src_type: str, edge: str, dst_type: str, edges: list, **_: Any) -> None:  # noqa: N802
        for src, dst, values in edges:
            row = (self.edges.setdefault(src_type, {}).setdefault(src, {}).setdefault(edge, {})
                   .setdefault(dst_type, {}).setdefault(dst, {}))
            row.update({k: {"value": v} for k, v in values.items()})

    def send(self, graph: Graph) -> None:
        if self.vertices or self.edges:
            graph.upsertData({"vertices": self.vertices, "edges": self.edges})
        self.vertices, self.edges = {}, {}
