"""An embedded, file-backed stand-in for a TigerGraph graph: same calls, same results, no server.

SentinelGraph talks to TigerGraph through a small slice of pyTigerGraph (REST++ upserts and reads) plus 15
interpreted GSQL queries. This module implements exactly that slice, and each GSQL query as Python with the
same semantics, so every tool, the agent and the API run unchanged on a laptop:

- the local sandbox and the free single-developer tier (`GRAPH_BACKEND=local`),
- the test suite, hermetically, in CI (TigerGraph stays the target for the nightly run),
- the MCP agent subprocess: state lives in one JSON file guarded by `flock`, so the API process and the
  agent's tool server see the same graph.

It is sized for one team's topology (hundreds to a few thousand vertices). Teams and production use TigerGraph.
A GSQL query without a local implementation raises, and a test checks every query in the codebase has one.
"""
import fcntl
import json
import os
import re
import threading
from collections import defaultdict, deque
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from .schema import EDGES, VERTICES

DEFAULTS = {"STRING": "", "INT": 0, "DOUBLE": 0.0, "BOOL": False}


def _attr_types(spec: str) -> dict[str, str]:
    out = {}
    for part in spec.split(","):
        if part.strip():
            name, typ = part.split()
            out[name] = typ
    return out


V_ATTRS = {v: _attr_types(spec) for v, spec in VERTICES.items()}
E_ATTRS = {e: _attr_types(attrs) for e, (_pairs, attrs) in EDGES.items()}


def _coerce(typ: str, value: Any) -> Any:
    if value is None:
        return DEFAULTS[typ]
    if typ == "INT":
        return int(value)
    if typ == "DOUBLE":
        return float(value)
    if typ == "BOOL":
        return value if isinstance(value, bool) else str(value).lower() == "true"
    return str(value)


class LocalGraph:
    """The pyTigerGraph calls SentinelGraph makes, against a JSON file."""

    def __init__(self, graphname: str, path: str | Path) -> None:
        self.graphname = graphname
        self.apiToken = ""  # noqa: N815 - mirrors pyTigerGraph
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lockfile = self.path.with_suffix(self.path.suffix + ".lock")
        self._mutex = threading.RLock()
        self._stamp: tuple[int, int] | None = None
        self.v: dict[str, dict[str, dict]] = {t: {} for t in VERTICES}
        # (edge type, from uid, to uid) -> {"ft": from type, "tt": to type, "a": attributes}
        self.e: dict[tuple[str, str, str], dict] = {}
        self._out: dict[tuple[str, str], list[tuple[str, str, str]]] | None = None
        self._in: dict[tuple[str, str], list[tuple[str, str, str]]] | None = None

    # ---- persistence -------------------------------------------------------------------------------------

    @contextmanager
    def _txn(self, write: bool = False) -> Iterator[None]:
        """Hold the file lock, load what another process wrote, and save if this was a write."""
        with self._mutex, open(self.lockfile, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX if write else fcntl.LOCK_SH)
            try:
                self._load()
                yield
                if write:
                    self._save()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _file_stamp(self) -> tuple[int, int] | None:
        try:
            st = self.path.stat()
        except FileNotFoundError:
            return None
        return st.st_mtime_ns, st.st_size

    def _load(self) -> None:
        stamp = self._file_stamp()
        if stamp == self._stamp:
            return
        self.v = {t: {} for t in VERTICES}
        self.e = {}
        if stamp:
            data = json.loads(self.path.read_text() or "{}")
            for t, rows in data.get("vertices", {}).items():
                self.v.setdefault(t, {}).update(rows)
            for et, src, dst, ft, tt, a in data.get("edges", []):
                self.e[(et, src, dst)] = {"ft": ft, "tt": tt, "a": a}
        self._stamp = stamp
        self._dirty()

    def _save(self) -> None:
        data = {"vertices": self.v,
                "edges": [[et, s, d, x["ft"], x["tt"], x["a"]] for (et, s, d), x in self.e.items()]}
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")))
        os.replace(tmp, self.path)
        self._stamp = self._file_stamp()

    def _dirty(self) -> None:
        self._out = self._in = None

    def _index(self) -> None:
        if self._out is not None:
            return
        self._out, self._in = defaultdict(list), defaultdict(list)
        for key in self.e:
            et, s, d = key
            self._out[(et, s)].append(key)
            self._in[(et, d)].append(key)

    # ---- primitives (used by the GSQL implementations, inside a transaction) -------------------------------

    def _vertex(self, vtype: str, uid: str) -> dict:
        row = {k: DEFAULTS[t] for k, t in V_ATTRS[vtype].items()}
        row.update(self.v[vtype].get(uid, {}))
        row["uid"] = uid
        return row

    def _all(self, vtype: str) -> list[dict]:
        return [self._vertex(vtype, uid) for uid in sorted(self.v[vtype])]

    def _type_of(self, uid: str) -> str | None:
        return next((t for t, rows in self.v.items() if uid in rows), None)

    def _put_vertex(self, vtype: str, uid: str, values: dict[str, Any]) -> None:
        types = V_ATTRS[vtype]
        row = self.v[vtype].setdefault(uid, {})
        for k, val in values.items():
            if k in types:
                row[k] = _coerce(types[k], val)

    def _edge_attrs(self, etype: str, attrs: dict) -> dict:
        row = {k: DEFAULTS[t] for k, t in E_ATTRS[etype].items()}
        row.update(attrs)
        return row

    def _put_edge(self, ft: str, etype: str, tt: str, src: str, dst: str, values: dict[str, Any]) -> None:
        types = E_ATTRS[etype]
        key = (etype, src, dst)
        if key not in self.e:
            self.e[key] = {"ft": ft, "tt": tt, "a": {}}
            self._dirty()
        for k, val in values.items():
            if k in types:
                self.e[key]["a"][k] = _coerce(types[k], val)

    def _edges(self, etype: str, uid: str, reverse: bool = False) -> list[tuple[str, dict]]:
        """(other end uid, attributes) of every `etype` edge leaving (or, reversed, entering) `uid`."""
        self._index()
        assert self._out is not None and self._in is not None
        keys = (self._in if reverse else self._out).get((etype, uid), [])
        return [(k[1] if reverse else k[2], self._edge_attrs(etype, self.e[k]["a"])) for k in sorted(keys)]

    def _delete_vertex(self, uid: str) -> None:
        for rows in self.v.values():
            rows.pop(uid, None)
        for key in [k for k in self.e if k[1] == uid or k[2] == uid]:
            del self.e[key]
        self._dirty()

    # ---- pyTigerGraph API ---------------------------------------------------------------------------------

    def upsertVertices(self, vertex_type: str, vertices: list) -> int:  # noqa: N802
        with self._txn(write=True):
            for uid, values in vertices:
                self._put_vertex(vertex_type, uid, values)
        return len(vertices)

    def upsertEdges(self, src_type: str, edge: str, dst_type: str, edges: list,  # noqa: N802
                    vertexMustExist: bool = False, **_: Any) -> int:  # noqa: N803
        n = 0
        with self._txn(write=True):
            for src, dst, values in edges:
                if vertexMustExist and (src not in self.v[src_type] or dst not in self.v[dst_type]):
                    continue
                self.v[src_type].setdefault(src, {})
                self.v[dst_type].setdefault(dst, {})
                self._put_edge(src_type, edge, dst_type, src, dst, values)
                n += 1
        return n

    def upsertData(self, data: dict, **_: Any) -> list:  # noqa: N802
        """REST++ upsert: vertices first, then edges (which create missing endpoints, as REST++ does)."""
        with self._txn(write=True):
            for vtype, rows in data.get("vertices", {}).items():
                for uid, values in rows.items():
                    self._put_vertex(vtype, uid, {k: v["value"] for k, v in values.items()})
            for ft, by_src in data.get("edges", {}).items():
                for src, by_edge in by_src.items():
                    for etype, by_tt in by_edge.items():
                        for tt, by_dst in by_tt.items():
                            for dst, values in by_dst.items():
                                self.v[ft].setdefault(src, {})
                                self.v[tt].setdefault(dst, {})
                                self._put_edge(ft, etype, tt, src, dst, {k: v["value"] for k, v in values.items()})
        return [{"accepted_vertices": 0, "accepted_edges": 0}]

    def getVertices(self, vertexType: str, select: str = "", where: str = "", **_: Any) -> list[dict]:  # noqa: N802,N803
        test = _where(where)
        with self._txn():
            rows = [r for r in self._all(vertexType) if test(r)]
        return [_vertex_out(vertexType, r) for r in rows]

    def getVerticesById(self, vertexType: str, vertexIds: str | list[str], **_: Any) -> list[dict]:  # noqa: N802,N803
        ids = [vertexIds] if isinstance(vertexIds, str) else list(vertexIds)
        with self._txn():
            return [_vertex_out(vertexType, self._vertex(vertexType, i)) for i in ids if i in self.v[vertexType]]

    def getEdges(self, sourceVertexType: str, sourceVertexId: str, edgeType: str = "", **_: Any) -> list[dict]:  # noqa: N802,N803
        reverse = edgeType.startswith("reverse_")
        etype = edgeType.removeprefix("reverse_")
        with self._txn():
            out = []
            for other, a in self._edges(etype, sourceVertexId, reverse=reverse):
                key = (etype, other, sourceVertexId) if reverse else (etype, sourceVertexId, other)
                rec = self.e[key]
                out.append({"e_type": edgeType, "directed": True, "from_type": sourceVertexType,
                            "from_id": sourceVertexId, "to_type": rec["ft"] if reverse else rec["tt"],
                            "to_id": other, "attributes": a})
            return out

    def delEdges(self, sourceVertexType: str, sourceVertexId: str, edgeType: str = "", **_: Any) -> dict:  # noqa: N802,N803
        with self._txn(write=True):
            gone = [k for k in self.e if k[1] == sourceVertexId and (not edgeType or k[0] == edgeType)]
            for k in gone:
                del self.e[k]
            self._dirty()
        return {edgeType: len(gone)}

    def gsql(self, command: str) -> str:
        """Only the schema checks in schema.ensure_schema: the local schema always exists."""
        if "SHOW GRAPH" in command:
            return f"- Graph {self.graphname}(...)"
        return "Service"

    def runInstalledQuery(self, name: str, params: dict | None = None, **_: Any) -> Any:  # noqa: N802
        raise RuntimeError("local graph: no installed queries (interpreted fallback is used)")

    def runInterpretedQuery(self, queryText: str, params: dict | None = None) -> list[dict]:  # noqa: N802,N803
        impl = _queries().get(_norm(queryText))
        if impl is None:
            raise NotImplementedError(f"no local implementation for GSQL query: {_norm(queryText)[:120]}...")
        writes = impl.__name__ in WRITE_QUERIES
        with self._txn(write=writes):
            out = impl(self, params or {})
            if writes:
                self._dirty()
        return [out]


# ---- REST++ helpers ----------------------------------------------------------------------------------------

_WHERE = re.compile(r'^\s*(\w+)\s*(!=|>=|<=|=|>|<)\s*(".*?"|[^,]*)\s*$')


def _where(expr: str) -> Callable[[dict], bool]:
    """REST++ `where`: comma-separated conjunction of attr OP value (strings quoted)."""
    tests = []
    for part in [p for p in re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', expr or "") if p.strip()]:
        m = _WHERE.match(part)
        if not m:
            raise ValueError(f"unsupported where clause: {part!r}")
        key, op, raw = m.groups()
        value: Any = raw[1:-1] if raw.startswith('"') else (float(raw) if re.fullmatch(r"-?\d+(\.\d+)?", raw) else raw)
        tests.append((key, op, value))

    def check(row: dict) -> bool:
        for key, op, value in tests:
            have = row.get(key)
            if op == "=" and have != value or op == "!=" and have == value:
                return False
            if op in (">", "<", ">=", "<=") and not {">": have > value, "<": have < value, ">=": have >= value,
                                                      "<=": have <= value}[op]:
                return False
        return True

    return check


def _vertex_out(vtype: str, row: dict, extra: dict | None = None) -> dict:
    return {"v_id": row["uid"], "v_type": vtype, "attributes": {**row, **(extra or {})}}


def _norm(gsql: str) -> str:
    return " ".join(gsql.split())


def _min(values: list[str]) -> str:
    """GSQL MinAccum<STRING>: the smallest value, printed as "" when nothing was added."""
    return min(values) if values else ""


# ---- the GSQL queries, as Python ----------------------------------------------------------------------------
# Each takes (graph, params) inside a transaction and returns what the query PRINTs, keyed like TigerGraph.

def q_context(g: LocalGraph, p: dict) -> dict:
    S = [s for s in g._all("Service") if s["name"] == p["service"]]
    T = sorted({t for s in S for t, _ in g._edges("OWNS", s["uid"], reverse=True) if g._type_of(t) == "Team"})
    P = sorted({pp for t in T for pp, a in g._edges("ON_CALL", t, reverse=True)
                if a["from_ms"] <= p["now"] < a["to_ms"]})
    D = sorted({d for s in S for rel in ("READS_FROM", "WRITES_TO") for d, _ in g._edges(rel, s["uid"])})
    R = sorted((g._vertex("Deployment", d) for s in S for d, _ in g._edges("DEPLOYED_TO", s["uid"], reverse=True)),
               key=lambda d: -d["at"])[:3]
    return {"S": [_vertex_out("Service", s) for s in S],
            "T": [_vertex_out("Team", g._vertex("Team", t)) for t in T],
            "P": [_vertex_out("Person", g._vertex("Person", x)) for x in P],
            "D": [_vertex_out("Database", g._vertex("Database", d)) for d in D],
            "R": [_vertex_out("Deployment", d) for d in R]}


def q_alerts(g: LocalGraph, _p: dict) -> dict:
    out = []
    for a in g._all("Alert"):
        if a["status"] != "firing":
            continue
        svcs = [g._vertex("Service", s) for s, _ in g._edges("FIRED_ON", a["uid"])]
        if svcs:
            out.append(_vertex_out("Alert", a, {"service": _min([s["name"] for s in svcs]),
                                                "service_uid": _min([s["uid"] for s in svcs]),
                                                "service_status": _min([s["status"] for s in svcs])}))
    return {"A": out}


def _reach(g: LocalGraph, p: dict, reverse: bool) -> dict:
    """Per-source BFS over DEPENDS_ON: first hop count, and the smallest edge uid it was first reached by."""
    services = {s["uid"]: s for s in g._all("Service")}
    dist: dict[str, dict[str, int]] = defaultdict(dict)
    via: dict[str, dict[str, str]] = defaultdict(dict)
    sources = [s for s in services.values() if s["name"] in set(p["sources"])]
    for src in sources:
        name = src["name"]
        dist[src["uid"]][name] = 0
        frontier, hop = [src["uid"]], 0
        while frontier and hop < int(p["depth"]):
            hop += 1
            found: dict[str, str] = {}
            for u in frontier:
                for t, a in g._edges("DEPENDS_ON", u, reverse=reverse):
                    if t in services and name not in dist[t]:
                        found[t] = min(found.get(t, a["uid"]), a["uid"])
            for t, e in found.items():
                dist[t][name] = hop
                via[t][name] = e
            frontier = sorted(found)
    return {"R": [_vertex_out("Service", services[u], {"dist": dict(dist[u]), "via": dict(via[u])})
                  for u in sorted(dist)]}


def q_reach_down(g: LocalGraph, p: dict) -> dict:
    return _reach(g, p, reverse=False)


def q_reach_up(g: LocalGraph, p: dict) -> dict:
    return _reach(g, p, reverse=True)


def _depends(g: LocalGraph) -> tuple[list[dict], dict[str, list[str]]]:
    services = g._all("Service")
    return services, {s["uid"]: [t for t, _ in g._edges("DEPENDS_ON", s["uid"])] for s in services}


def q_pagerank(g: LocalGraph, _p: dict) -> dict:
    services, out = _depends(g)
    score = {s["uid"]: 1.0 for s in services}
    for _ in range(50):
        received = dict.fromkeys(score, 0.0)
        for s, targets in out.items():
            for t in targets:
                received[t] += score[s] / len(targets)
        nxt = {u: 0.15 + 0.85 * received[u] for u in score}
        diff = max((abs(nxt[u] - score[u]) for u in score), default=0.0)
        score = nxt
        if diff <= 0.0001:
            break
    total = sum(score.values()) or 1.0
    return {"S": [_vertex_out("Service", s, {"score": score[s["uid"]] / total}) for s in services]}


def q_betweenness(g: LocalGraph, _p: dict) -> dict:
    """Brandes over directed DEPENDS_ON: score(v) = sum over sources s != v of delta_s(v)."""
    services, out = _depends(g)
    score = dict.fromkeys(out, 0.0)
    for s in out:
        dist, sigma, order = {s: 0}, defaultdict(float, {s: 1.0}), []
        queue = deque([s])
        while queue:
            v = queue.popleft()
            order.append(v)
            for w in out[v]:
                if w not in dist:
                    dist[w] = dist[v] + 1
                    queue.append(w)
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
        delta = defaultdict(float)
        for w in reversed(order):
            for v in [v for v in out if w in out[v] and v in dist and dist[v] == dist[w] - 1]:
                delta[v] += sigma[v] / sigma[w] * (1 + delta[w])
            if w != s:
                score[w] += delta[w]
    return {"All": [_vertex_out("Service", s, {"score": score[s["uid"]]}) for s in services]}


def q_recent_changes(g: LocalGraph, p: dict) -> dict:
    out = []
    names = set(p["services"])
    for s in g._all("Service"):
        if s["name"] not in names:
            continue
        for d, _ in g._edges("DEPLOYED_TO", s["uid"], reverse=True):
            dep = g._vertex("Deployment", d)
            if dep["at"] < int(p["since"]):
                continue
            commits = [g._vertex("Commit", c) for c, _ in g._edges("CONTAINS", d)]
            people = [g._vertex("Person", x) for c in commits for x, _ in g._edges("AUTHORED_BY", c["uid"])]
            teams = [g._vertex("Team", t)["name"] for x in people for t, _ in g._edges("MEMBER_OF", x["uid"])]
            out.append(_vertex_out("Deployment", dep, {
                "service": s["name"], "commit_uid": _min([c["uid"] for c in commits]),
                "sha": _min([c["sha"] for c in commits]), "message": _min([c["message"] for c in commits]),
                "author": _min([x["name"] for x in people]), "author_uid": _min([x["uid"] for x in people]),
                "author_team": _min(teams)}))
    return {"D": out}


def q_incidents(g: LocalGraph, p: dict) -> dict:
    out = []
    for i in g._all("Incident"):
        if p.get("status") and i["status"] != p["status"]:
            continue
        u = i["uid"]
        rc_uid, rc_service = [], []
        for t, _ in g._edges("ROOT_CAUSE", u):
            if g._type_of(t) == "Service":
                rc_uid.append(t)
                rc_service.append(g._vertex("Service", t)["name"])
            elif g._type_of(t) == "Deployment":
                for s, _ in g._edges("DEPLOYED_TO", t):
                    rc_uid.append(t)
                    rc_service.append(g._vertex("Service", s)["name"])
        actions = [g._vertex("Action", a) for a, _ in g._edges("RESOLVED_BY", u)]
        runbooks = [g._vertex("Runbook", r) for r, _ in g._edges("FOLLOWED", u)]
        sim_out = {g._vertex("Incident", o)["id"] for o, _ in g._edges("SIMILAR_TO", u)}
        sim_in = {g._vertex("Incident", o)["id"] for o, _ in g._edges("SIMILAR_TO", u, reverse=True)}
        out.append(_vertex_out("Incident", i, {
            "affected": sorted({g._vertex("Service", s)["name"] for s, _ in g._edges("AFFECTED", u)}),
            "fixes": sorted({a["kind"] for a in actions}),
            "actions": sorted({f"{a['kind']}|{a['status']}" for a in actions}),
            "similar_out": sorted(sim_out), "similar_any": sorted(sim_out | sim_in),
            "rc_uid": _min(rc_uid), "rc_service": _min(rc_service),
            "runbook_uid": _min([r["uid"] for r in runbooks]), "runbook": _min([r["title"] for r in runbooks]),
            "runbook_steps": _min([r["steps"] for r in runbooks])}))
    return {"I": out}


def q_health(g: LocalGraph, _p: dict) -> dict:
    services = g._all("Service")
    deps: dict[str, list[str]] = {}
    for s in services:
        names = sorted({g._vertex("Service", t)["name"] for t, a in g._edges("DEPENDS_ON", s["uid"])
                        if a["breaker"] != "open"})
        if names:
            deps[s["name"]] = names
    alerts: dict[str, list[str]] = defaultdict(list)
    for a in g._all("Alert"):
        if a["status"] == "firing":
            for s, _ in g._edges("FIRED_ON", a["uid"]):
                alerts[g._vertex("Service", s)["name"]].append(a["uid"])
    return {"S": [_vertex_out("Service", s) for s in services], "@@deps": deps,
            "@@alerts": {k: sorted(v) for k, v in alerts.items()}}


def q_settle(g: LocalGraph, p: dict) -> dict:
    settled = []
    for i in g._all("Incident"):
        if i["status"] not in ("investigating", "mitigating"):
            continue
        alerts = [g._vertex("Alert", a) for a, _ in g._edges("TRIGGERED_BY", i["uid"])]
        if alerts and not any(a["status"] == "firing" for a in alerts):
            g._put_vertex("Incident", i["uid"], {"status": "resolved", "resolved_at": p["now"]})
            settled.append(_vertex_out("Incident", {"uid": i["uid"], "id": i["id"]}))
    return {"I": settled}


def _forward_edges(g: LocalGraph) -> list[dict]:
    return [{"e_type": et, "directed": True, "from_type": x["ft"], "from_id": s, "to_type": x["tt"], "to_id": d,
             "attributes": g._edge_attrs(et, x["a"])} for (et, s, d), x in sorted(g.e.items())]


def q_snapshot(g: LocalGraph, _p: dict) -> dict:
    return {"All": [_vertex_out(t, g._vertex(t, u)) for t in VERTICES for u in sorted(g.v[t])],
            "@@edges": _forward_edges(g)}


def q_counts(g: LocalGraph, _p: dict) -> dict:
    return {"nodes": sum(len(rows) for rows in g.v.values()), "edges": len(g.e)}


def q_wipe(g: LocalGraph, _p: dict) -> dict:
    n = sum(len(rows) for rows in g.v.values())
    g.v = {t: {} for t in VERTICES}
    g.e = {}
    return {"deleted": n}


def _set_on_call(g: LocalGraph, p: dict) -> int:
    n = 0
    for key, x in g.e.items():
        if key[0] == "ON_CALL":
            x["a"].update(from_ms=int(p["from_ms"]), to_ms=int(p["to_ms"]))
            n += 1
    return n


def q_refresh_on_call(g: LocalGraph, p: dict) -> dict:
    return {"@@n": _set_on_call(g, p)}


def q_quiet(g: LocalGraph, p: dict) -> dict:
    _set_on_call(g, p)
    for uid in g.v["Service"]:
        g._put_vertex("Service", uid, {"status": "healthy", "root_fault": False})
    for (et, _s, _d), x in g.e.items():
        if et == "DEPENDS_ON":
            x["a"]["breaker"] = "closed"
    for uid in g.v["Database"]:
        g._put_vertex("Database", uid, {"status": "healthy"})
    for a in g._all("Alert"):
        if a["status"] == "firing":
            g._put_vertex("Alert", a["uid"], {"status": "resolved"})
    for i in g._all("Incident"):
        if i["status"] != "resolved":
            g._put_vertex("Incident", i["uid"], {"status": "abandoned"})
    for c in g._all("Action"):
        if c["status"] in ("pending", "approved"):
            g._put_vertex("Action", c["uid"], {"status": "expired"})
    return {'"ok"': "ok"}


def q_cleanup(g: LocalGraph, _p: dict) -> dict:
    def unreferenced(vtype: str, edge: str) -> list[str]:
        return [u for u in sorted(g.v[vtype]) if not g._edges(edge, u, reverse=True)]

    for vtype, edge in (("Alert", "TRIGGERED_BY"), ("Action", "RESOLVED_BY"), ("Page", "PAGED")):
        for u in unreferenced(vtype, edge):
            g._delete_vertex(u)
    scenario = [d for d in g._all("Deployment") if d["origin"] == "scenario"]
    for d in scenario:
        if g._edges("ROOT_CAUSE", d["uid"], reverse=True):
            g._put_vertex("Deployment", d["uid"], {"status": "rolled_back"})
        else:
            for c, _ in g._edges("CONTAINS", d["uid"]):
                g._delete_vertex(c)
            g._delete_vertex(d["uid"])
    return {'"ok"': "ok"}


WRITE_QUERIES = {"q_settle", "q_wipe", "q_refresh_on_call", "q_quiet", "q_cleanup"}

_registry: dict[str, Callable[[LocalGraph, dict], dict]] = {}


def _queries() -> dict[str, Callable[[LocalGraph, dict], dict]]:
    """Normalized GSQL text -> implementation. Built lazily: the tool modules import db, which imports this."""
    if not _registry:
        from .api import graph_view
        from .seed import generator, scenarios
        from .tools import algorithms, health, incidents, memory, read, rootcause

        _registry.update({_norm(q): impl for q, impl in (
            (read.CONTEXT_GSQL, q_context), (read.ALERTS_GSQL, q_alerts),
            (read.reach_gsql("down"), q_reach_down), (read.reach_gsql("up"), q_reach_up),
            (algorithms.PAGERANK_GSQL, q_pagerank), (algorithms.BETWEENNESS_GSQL, q_betweenness),
            (rootcause.RECENT_CHANGES_GSQL, q_recent_changes), (memory.INCIDENTS_GSQL, q_incidents),
            (health.HEALTH_GSQL, q_health), (incidents.SETTLE_GSQL, q_settle),
            (graph_view.SNAPSHOT_GSQL, q_snapshot), (generator.COUNTS_GSQL, q_counts),
            (generator.WIPE_GSQL, q_wipe), (generator.REFRESH_ON_CALL_GSQL, q_refresh_on_call),
            (scenarios.QUIET_GSQL, q_quiet), (scenarios.CLEANUP_GSQL, q_cleanup),
        )})
    return _registry
