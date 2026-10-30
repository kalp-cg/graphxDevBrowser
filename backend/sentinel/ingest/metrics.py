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


ONSET_Z = Z_ALERT / 2   # a series has "started deviating" when it is this far from normal


def score_series(points: list[list[float]], recent_seconds: int) -> float | None:
    """How far the recent window's mean sits from the older history, in units of its normal wobble. None: too little history."""
    scored = score_with_onset(points, recent_seconds)
    return None if scored is None else scored[0]


def score_with_onset(points: list[list[float]], recent_seconds: int) -> tuple[float, float | None] | None:
    """(deviation, when it started): the first moment in the recent window the series was already far from normal, or None if never."""
    pts = sorted((float(t), float(v)) for t, v in points if v is not None)
    if not pts:
        return None
    cut = pts[-1][0] - recent_seconds
    old = [v for t, v in pts if t <= cut]
    new = [(t, v) for t, v in pts if t > cut]
    if len(old) < MIN_BASELINE or not new:
        return None
    med, spread = baselines.scale(old)
    z = abs(sum(v for _, v in new) / len(new) - med) / spread
    onset = next((t for t, v in new if abs(v - med) / spread >= ONSET_Z), None)
    return z, onset


def analyze(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """service -> {"z": how far it left normal, "metric": the series that showed it most, "onset": when it started (epoch seconds)}.

    A service exposes dozens of series, so the strongest of them alone is often just the noisiest one. A real fault moves several related
    series (CPU and latency and request rate), so a service's score is the mean of its two strongest; a service with a single series
    is judged on that one."""
    recent = int(payload.get("recent_seconds") or 300)
    per: dict[str, list[tuple[float, str, float | None]]] = {}
    for s in payload.get("series", []):
        service, metric = s.get("service"), s.get("metric")
        if not service or not metric:
            continue
        scored = score_with_onset(s.get("points", []), recent)
        per.setdefault(service, []).append((scored[0], metric, scored[1]) if scored else (0.0, metric, None))
    found: dict[str, dict[str, Any]] = {}
    for service, zs in per.items():
        zs.sort(key=lambda r: -r[0])
        top = zs[:2]
        onsets = [o for _, _, o in top if o is not None]
        found[service] = {"z": sum(z for z, _, _ in top) / len(top), "metric": zs[0][1], "strongest": zs[0][0],
                          "onset": min(onsets) if onsets else None}
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
         "at": int(v["onset"] * 1000) if v.get("onset") else at, "status": "firing", "scenario": SCENARIO}
        for uid, (s, v) in alerts.items()])
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
