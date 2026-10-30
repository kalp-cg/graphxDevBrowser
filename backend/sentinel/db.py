"""TigerGraph connection helpers.

Graph logic runs as interpreted GSQL (no install/compile step; the graph is a few hundred vertices). Plain
creates and attribute updates go through REST++ upserts. With GRAPH_BACKEND=local the same calls go to the
embedded engine in localgraph.py instead of a TigerGraph server.
"""
import threading
import time
from pathlib import Path
from typing import Any

from pyTigerGraph import TigerGraphConnection
from pyTigerGraph.common.exception import TigerGraphException

from .config import settings

Graph = TigerGraphConnection

TOKEN_MAX_AGE_S = 24 * 60 * 60  # tokens minted from the secret live a week; renew daily

_lock = threading.Lock()
_conns: dict[str, Graph] = {}
_token: dict[str, Any] = {"value": settings.tg_token, "at": 0.0}


def _connect(name: str) -> Graph:
    conn = TigerGraphConnection(
        host=settings.tg_host,
        graphname=name,
        gsqlSecret=settings.tg_secret,
        username=settings.tg_username,
        password=settings.tg_password,
        apiToken=_token["value"],
        tgCloud=settings.tg_host.startswith("https"),
    )
    # pyTigerGraph 2.0 turns certificate verification off for every https URL without a CA file. The secret
    # and tokens travel on this connection, so verify against the system CAs (tgcloud.io has a public cert).
    conn.verify = True
    return conn


def _fresh_token(conn: Graph) -> str:
    """Mint a token from the secret (once a day); without a secret, use TG_TOKEN as given."""
    if settings.tg_secret and time.time() - _token["at"] > TOKEN_MAX_AGE_S:
        tok = conn.getToken(settings.tg_secret)
        _token.update(value=tok[0] if isinstance(tok, tuple) else tok, at=time.time())
    return _token["value"]


def get_graph(name: str | None = None) -> Graph:
    name = name or settings.tg_graph
    if settings.graph_backend == "local":
        from .localgraph import LocalGraph

        with _lock:
            conn = _conns.get(name)
            if conn is None:
                conn = _conns[name] = LocalGraph(name, Path(settings.local_graph_dir) / f"{name}.json")
        return conn  # type: ignore[return-value]
    with _lock:
        conn = _conns.get(name)
        if conn is None:
            conn = _conns[name] = _connect(name)
        token = _fresh_token(conn)
        if token and conn.apiToken != token:
            conn = _conns[name] = _connect(name)
    return conn


def run(graph: Graph, gsql: str, params: dict[str, Any] | None = None,
        query_name: str | None = None) -> dict[str, Any]:
    """Run a query: uses runInstalledQuery if query_name is provided and installed;
    falls back cleanly to runInterpretedQuery otherwise."""
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}
    if query_name:
        try:
            res = graph.runInstalledQuery(query_name, clean_params)
            out: dict[str, Any] = {}
            if isinstance(res, list):
                for item in res:
                    if isinstance(item, dict):
                        out.update(item)
            elif isinstance(res, dict):
                out = res
            if out:
                return out
        except Exception:  # noqa: BLE001 - if query is not installed or errors, fall back to interpreted
            pass

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
    try:
        found = graph.getVerticesById(vertex_type, uid)
    except TigerGraphException as exc:
        if exc.code == "601":  # REST++ answers a missing id with an error, not an empty list
            return None
        raise
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
    """Collects upserts (same calls as a connection, so `upsert` / `link` accept it) and sends them as one
    REST++ request. Every round trip to a cloud instance costs ~0.4 s; seeding is ~100 of them otherwise."""

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
