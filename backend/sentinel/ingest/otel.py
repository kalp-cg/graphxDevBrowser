"""OpenTelemetry traces -> the dependency graph, health and alerts.

Input is OTLP/JSON: what an OpenTelemetry Collector sends with the `otlphttp` exporter (`encoding: json`) or
writes with its `file` exporter. Nothing is configured by hand:

- A span whose parent span belongs to another component is a call, so parent component DEPENDS_ON child
  component. Consumer spans (async messaging) are not dependencies: a slow consumer doesn't break the producer.
- A CLIENT span with `db.system` is a call into a Database.
- A component's error rate is its error spans / all its spans. An error span with no erroring child span
  *originates* the failure there; one with an erroring child only passes it on. Components that originate
  errors are root faults; the rest are symptoms.

A component is a service (`service.name`, microservices) or a code module inside one (`code.namespace`, for a
monolith: see monolith.py). Optional resource attributes `service.team`, `service.tier`, `service.version`
and `telemetry.sdk.language` fill in ownership and metadata.
"""
import os
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from .. import baselines
from ..db import Batch, Graph, link, upsert
from ..tools.common import now_ms

ERROR_RATE = 0.05  # alert threshold
DOWN_RATE = 0.5
# A component is slow when its p90 span duration is this far above what it normally is (see baselines.py): both a multiple of its
# normal and many "normal wobbles", with enough spans in the batch to mean something.
SLOW_RATIO = float(os.getenv("OTEL_SLOW_RATIO", "1.25"))
SLOW_Z = float(os.getenv("OTEL_SLOW_Z", "6"))
MIN_SPANS = 20
# Fail fast, recover slowly: a firing component must look healthy for this long before its alert resolves. One
# clean batch in a noisy stream (a few requests, none failed by chance) is not a recovery.
RECOVERY_MS = int(os.getenv("OTEL_RECOVERY_MS", "15000"))
WRITE_OPS = {"INSERT", "UPDATE", "DELETE", "UPSERT", "SET", "HSET", "PUT", "MERGE", "CREATE"}
SERVER, CLIENT, CONSUMER = 2, 3, 5
KINDS = {"SPAN_KIND_SERVER": SERVER, "SPAN_KIND_CLIENT": CLIENT, "SPAN_KIND_CONSUMER": CONSUMER}
STATUS_ERROR = 2


@dataclass
class Span:
    trace: str
    id: str
    parent: str
    component: str
    kind: int
    error: bool
    ms: float
    attrs: dict[str, Any]


@dataclass
class Component:
    name: str
    spans: int = 0
    errors: int = 0
    origins: int = 0
    meta: dict[str, str] = field(default_factory=dict)
    ms: list[float] = field(default_factory=list)
    slow: bool = False

    @property
    def p90_ms(self) -> float | None:
        return statistics.quantiles(self.ms, n=10)[-1] if len(self.ms) >= MIN_SPANS else None

    @property
    def error_rate(self) -> float:
        return self.errors / self.spans if self.spans else 0.0

    @property
    def status(self) -> str:
        if self.error_rate >= DOWN_RATE:
            return "down"
        return "degraded" if self.error_rate >= ERROR_RATE or self.slow else "healthy"

    @property
    def root_fault(self) -> bool:
        return self.spans > 0 and self.origins / self.spans >= ERROR_RATE


def _value(v: dict) -> Any:
    for k in ("stringValue", "intValue", "doubleValue", "boolValue"):
        if k in v:
            return int(v[k]) if k == "intValue" else v[k]
    return None


def _attrs(items: list[dict] | None) -> dict[str, Any]:
    return {a["key"]: _value(a.get("value", {})) for a in items or []}


def parse(payload: dict, component: str = "service") -> tuple[list[Span], dict[str, dict[str, str]]]:
    """Spans from an OTLP/JSON export, plus resource metadata per component."""
    spans, meta = [], {}
    for rs in payload.get("resourceSpans", []):
        res = _attrs(rs.get("resource", {}).get("attributes"))
        service = res.get("service.name", "unknown")
        for ss in rs.get("scopeSpans", []):
            for s in ss.get("spans", []):
                attrs = _attrs(s.get("attributes"))
                name = attrs.get("code.namespace", service) if component == "module" else service
                kind = s.get("kind", 0)
                status = s.get("status", {}).get("code", 0)
                spans.append(Span(
                    trace=s["traceId"], id=s["spanId"], parent=s.get("parentSpanId", ""), component=name,
                    kind=KINDS.get(kind, kind) if isinstance(kind, str) else kind,
                    error=status in (STATUS_ERROR, "STATUS_CODE_ERROR"),
                    ms=(int(s.get("endTimeUnixNano", 0)) - int(s.get("startTimeUnixNano", 0))) / 1e6, attrs=attrs,
                ))
                meta.setdefault(name, {k.removeprefix("service.").removeprefix("telemetry.sdk."): str(v)
                                       for k, v in res.items()
                                       if k in ("service.team", "service.tier", "service.version",
                                                "telemetry.sdk.language")})
    return spans, meta


def _protocol(a: dict) -> str:
    if "rpc.system" in a:
        return str(a["rpc.system"])
    if "messaging.system" in a:
        return str(a["messaging.system"])
    return "http" if any(k.startswith("http.") for k in a) else "tcp"


def analyze(spans: list[Span], meta: dict[str, dict[str, str]]) -> dict[str, Any]:
    """Components (with health), component->component calls and component->database access."""
    by_id = {(s.trace, s.id): s for s in spans}
    erring_children: set[tuple[str, str]] = {(s.trace, s.parent) for s in spans if s.error and s.parent}
    comps: dict[str, Component] = {}
    calls: dict[tuple[str, str], list[float]] = defaultdict(list)
    protocols: dict[tuple[str, str], str] = {}
    dbs: dict[tuple[str, str], str] = {}
    db_engines: dict[str, str] = {}
    for s in spans:
        c = comps.setdefault(s.component, Component(s.component, meta=meta.get(s.component, {})))
        c.spans += 1
        c.ms.append(s.ms)
        if s.error:
            c.errors += 1
            if (s.trace, s.id) not in erring_children:
                c.origins += 1
        parent = by_id.get((s.trace, s.parent))
        if parent and parent.component != s.component and s.kind != CONSUMER:
            calls[(parent.component, s.component)].append(s.ms)
            protocols[(parent.component, s.component)] = _protocol(parent.attrs | s.attrs)
        if s.kind == CLIENT and "db.system" in s.attrs:
            db = str(s.attrs.get("db.name") or s.attrs.get("db.namespace") or s.attrs.get("server.address")
                     or s.attrs["db.system"])
            op = str(s.attrs.get("db.operation") or s.attrs.get("db.operation.name") or "").upper()
            rel = "WRITES_TO" if op in WRITE_OPS else "READS_FROM"
            dbs[(s.component, db)] = "WRITES_TO" if dbs.get((s.component, db)) == "WRITES_TO" else rel
            db_engines[db] = str(s.attrs["db.system"])
    return {"components": comps, "calls": calls, "protocols": protocols, "dbs": dbs, "db_engines": db_engines}


def write(graph: Graph, found: dict[str, Any], kind: str = "service", at: int | None = None,
          health: bool = True) -> dict[str, Any]:
    """Upsert what the traces showed. Each unhealthy component gets one firing `error_rate` alert (updated, not
    duplicated, by later batches); a component seen healthy again gets its alert resolved. A component this
    batch didn't see keeps its state: another source (collector, region) may be reporting it. A firing
    component that looks healthy keeps its status and alert until it has stayed healthy for RECOVERY_MS.

    `health=False` writes topology only (components, calls, databases): new components start healthy and
    nothing else changes status or alerts. That is how passive browser traffic is written."""
    at = at or now_ms()
    batch = Batch()
    comps: dict[str, Component] = found["components"]
    graph_name = getattr(graph, "graphname", "default")
    normal: dict[str, list[float]] = baselines.load(graph_name) if health else {}
    if health:
        learned = False
        for c in comps.values():
            p90 = c.p90_ms
            if p90 is None:
                continue
            c.slow = baselines.is_slow(p90, normal.get(c.name, []), SLOW_Z, SLOW_RATIO)
            if not c.slow and c.status == "healthy":  # normal is learned only from healthy batches, never from a fault
                normal[c.name] = (normal.get(c.name, []) + [p90])[-baselines.KEEP:]
                learned = True
        if learned:
            baselines.save(graph_name, normal)
    existing = set() if health else {v["v_id"] for v in graph.getVertices("Service", select="name")}
    alert_uids = {f"alert:otel-{c.name}": c for c in comps.values()}
    firing_at = {v["v_id"]: v["attributes"]["at"]
                 for v in graph.getVertices("Alert", where='scenario="otel",status="firing"')} if health else {}
    holding = {uid for uid, c in alert_uids.items()
               if c.status == "healthy" and uid in firing_at and at - firing_at[uid] < RECOVERY_MS}
    rows = []
    for c in comps.values():
        row = {"uid": f"svc:{c.name}", "name": c.name, "kind": kind}
        if health:
            if f"alert:otel-{c.name}" not in holding:
                row.update(status=c.status, root_fault=c.root_fault)
        elif row["uid"] not in existing:
            row.update(status="healthy", root_fault=False)
        for key, attr in (("version", "version"), ("tier", "tier"), ("language", "language")):
            if c.meta.get(key):
                row[attr] = c.meta[key]
        rows.append(row)
    upsert(batch, "Service", rows)
    teams = {c.meta["team"] for c in comps.values() if c.meta.get("team")}
    upsert(batch, "Team", [{"uid": f"team:{t}", "name": t, "slack_channel": f"#team-{t}"} for t in teams])
    link(batch, "Team", "OWNS", "Service", [(f"team:{c.meta['team']}", f"svc:{c.name}")
                                            for c in comps.values() if c.meta.get("team")])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": found["protocols"][(a, b)], "weight": 1,
                                  "latency_ms": round(sum(ms) / len(ms))})
        for (a, b), ms in sorted(found["calls"].items())
    ])
    upsert(batch, "Database", [{"uid": f"db:{d}", "name": d, "engine": e, "status": "healthy"}
                               for d, e in found["db_engines"].items()])
    for (svc, db), rel in sorted(found["dbs"].items()):
        link(batch, "Service", rel, "Database", [(f"svc:{svc}", f"db:{db}", {"uid": f"e:{svc}-{rel.lower()}->{db}"})])

    firing = [uid for uid, c in alert_uids.items() if c.status != "healthy"] if health else []
    if health:
        upsert(batch, "Alert", [
            ({"uid": uid, "id": uid.removeprefix("alert:"), "metric": "p90_latency_ms",
              "value": round(baselines.z(c.p90_ms or 0, normal[c.name]), 1), "threshold": SLOW_Z, "at": firing_at.get(uid, at), "status": "firing", "scenario": "otel"}
             if c.slow and c.error_rate < ERROR_RATE else
             {"uid": uid, "id": uid.removeprefix("alert:"), "metric": "error_rate", "value": round(c.error_rate, 3),
              "threshold": ERROR_RATE, "at": firing_at.get(uid, at), "status": "firing", "scenario": "otel"})
            for uid, c in alert_uids.items() if uid in firing
        ] + [{"uid": uid, "status": "resolved"} for uid in firing_at
             if uid in alert_uids and uid not in firing and uid not in holding])
        link(batch, "Alert", "FIRED_ON", "Service", [(uid, f"svc:{alert_uids[uid].name}") for uid in firing])
    batch.send(graph)
    return {
        "components": len(comps), "calls": len(found["calls"]), "databases": len(found["db_engines"]),
        "unhealthy": sorted(c.name for c in comps.values() if c.status != "healthy"),
        "root_faults": sorted(c.name for c in comps.values() if c.root_fault),
        "alerting": sorted(uid.removeprefix("alert:otel-") for uid in firing),
        "recovering": sorted(uid.removeprefix("alert:otel-") for uid in holding),
    }


def ingest_traces(graph: Graph, payload: dict, component: str = "service", health: bool = True,
                  at: int | None = None) -> dict[str, Any]:
    """Parse an OTLP/JSON export and write its topology (and, unless health=False, health and alerts)."""
    spans, meta = parse(payload, component)
    return ingest_spans(graph, spans, meta, component, health, at)


def ingest_spans(graph: Graph, spans: list[Span], meta: dict[str, dict[str, str]] | None = None, component: str = "service",
                 health: bool = True, at: int | None = None) -> dict[str, Any]:
    """The same for spans already parsed."""
    return write(graph, analyze(spans, meta or {}), kind="module" if component == "module" else "service", at=at, health=health)


def record_change(graph: Graph | Batch, service: str, version: str, at: int, author: str, message: str,
                  sha: str, files: list[str] | None = None, origin: str = "ingest") -> str:
    """A deploy marker (from CI/CD, a flag change, or a git commit touching a module): Deployment -> Commit ->
    Person, deployed to the component. Returns the deployment uid."""
    from ..seed.history import create_deployments

    handle = author.lower().replace(" ", "-")
    upsert(graph, "Person", [{"uid": f"person:{handle}", "handle": handle, "name": author}])
    create_deployments(graph, [{"svc": service, "version": version, "at": at, "summary": message, "sha": sha,
                                "message": message, "files": len(files or []), "author": handle}], origin=origin)
    if files:
        upsert(graph, "Commit", [{"uid": f"commit:{sha}", "files": "\n".join(files)}])
    return f"dep:{service}:{version}"
