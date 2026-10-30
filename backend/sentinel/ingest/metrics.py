"""Resource and request metrics -> service health.

Most real faults do not raise errors: a CPU-starved, memory-leaking or network-delayed service answers slowly, or not at all. What
shows is its own metrics jumping away from its history. This reads time series (CPU, memory, latency, socket counts, ... whatever the
service exposes), compares the most recent window with the history before it, and marks a service unhealthy when any of its series is
far outside its own normal. It never alerts on a service for being busy in absolute terms.

Input is plain JSON, easy to produce from a Prometheus `query_range`:

    {"series": [{"service": "cartservice", "metric": "cpu", "points": [[1705353846, 0.21], [1705353847, 0.2], ...]}],
     "recent_seconds": 300}

`recent_seconds` is the window under test; everything older is the baseline. The most deviating series is named in the alert.
"""
from typing import Any

from .. import baselines
from ..db import Batch, Graph, link, upsert
from ..tools.common import now_ms

Z_ALERT = 10.0         # how many "normal wobbles" away counts as a fault
MIN_BASELINE = 10      # points of history needed before a series is judged
SCENARIO = "metrics"


def score_series(points: list[list[float]], recent_seconds: int) -> float | None:
    """How far the recent window's mean sits from the older history, in units of its normal wobble. None: too little history."""
    pts = sorted((float(t), float(v)) for t, v in points if v is not None)
    if not pts:
        return None
    cut = pts[-1][0] - recent_seconds
    old = [v for t, v in pts if t <= cut]
    new = [v for t, v in pts if t > cut]
    if len(old) < MIN_BASELINE or not new:
        return None
    med, spread = baselines.scale(old)
    return abs(sum(new) / len(new) - med) / spread


def analyze(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """service -> {"z": strongest deviation, "metric": the series that showed it}."""
    recent = int(payload.get("recent_seconds") or 300)
    found: dict[str, dict[str, Any]] = {}
    for s in payload.get("series", []):
        service, metric = s.get("service"), s.get("metric")
        if not service or not metric:
            continue
        z = score_series(s.get("points", []), recent)
        if z is not None and z > found.get(service, {"z": 0.0})["z"]:
            found[service] = {"z": z, "metric": metric}
        else:
            found.setdefault(service, {"z": 0.0, "metric": metric})
    return found


def ingest_metrics(graph: Graph, payload: dict[str, Any], at: int | None = None) -> dict[str, Any]:
    """Mark the services whose metrics left their normal as degraded, with one firing alert each; resolve the ones that came back."""
    at = at or now_ms()
    scores = analyze(payload)
    existing = {v["v_id"]: v["attributes"] for v in graph.getVertices("Service", select="name,status")}
    firing_before = {v["v_id"] for v in graph.getVertices("Alert", where=f'scenario="{SCENARIO}",status="firing"')}
    bad = {s: v for s, v in scores.items() if v["z"] >= Z_ALERT}
    batch = Batch()
    upsert(batch, "Service", [
        {"uid": f"svc:{s}", "name": s, "kind": "service", "status": "healthy", "root_fault": False}
        for s in scores if f"svc:{s}" not in existing])
    # Only raise an unhealthy service; "down" (from errors) is never softened to "degraded" by a metric.
    upsert(batch, "Service", [{"uid": f"svc:{s}", "status": "degraded"} for s in bad
                              if existing.get(f"svc:{s}", {}).get("status") != "down"])
    alerts = {f"alert:{SCENARIO}-{s}": (s, v) for s, v in bad.items()}
    upsert(batch, "Alert", [
        {"uid": uid, "id": uid.removeprefix("alert:"), "metric": v["metric"], "value": round(v["z"], 1), "threshold": Z_ALERT,
         "at": at, "status": "firing", "scenario": SCENARIO} for uid, (s, v) in alerts.items()])
    link(batch, "Alert", "FIRED_ON", "Service", [(uid, f"svc:{s}") for uid, (s, _v) in alerts.items()])
    cleared = sorted(firing_before - set(alerts))
    upsert(batch, "Alert", [{"uid": uid, "status": "resolved"} for uid in cleared])
    upsert(batch, "Service", [{"uid": f"svc:{uid.removeprefix(f'alert:{SCENARIO}-')}", "status": "healthy"} for uid in cleared
                              if f"svc:{uid.removeprefix(f'alert:{SCENARIO}-')}" in existing])
    batch.send(graph)
    return {"series": len(payload.get("series", [])), "services": len(scores),
            "unhealthy": sorted(bad), "resolved": [u.removeprefix(f"alert:{SCENARIO}-") for u in cleared],
            "strongest": sorted(({"service": s, "metric": v["metric"], "z": round(v["z"], 1)} for s, v in scores.items()),
                                key=lambda r: -r["z"])[:5]}
