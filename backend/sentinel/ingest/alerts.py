"""Prometheus Alertmanager webhook -> graph alerts and service health.

Alertmanager sends JSON payloads containing lists of firing and resolved alerts.
SentinelGraph maps each alert to its targeted Service, creates/updates Alert vertices
and edges in TigerGraph, marks affected services as degraded/down, and triggers
health recomputation when alerts resolve.
"""
from typing import Any
import uuid

from ..db import Batch, Graph, link, upsert
from ..tools.common import now_ms
from ..tools.health import recompute_health


def ingest_alertmanager(graph: Graph, payload: dict[str, Any]) -> dict[str, Any]:
    """Parse Prometheus Alertmanager webhook payload and update the graph."""
    alerts = payload.get("alerts", [])
    batch = Batch()
    firing_uids: list[str] = []
    resolved_uids: list[str] = []
    resolved_services: set[str] = set()
    affected_services: set[str] = set()
    now = now_ms()

    # Query currently known alertmanager alerts so we can resolve by id
    known_alerts = {
        v["v_id"] for v in graph.getVertices("Alert", select="status", where='scenario="alertmanager"')
    }

    for alert in alerts:
        labels = alert.get("labels", {})
        annotations = alert.get("annotations", {})
        status = alert.get("status", "firing").lower()
        alertname = labels.get("alertname", "Alert")
        svc_name = labels.get("service") or labels.get("app") or labels.get("job")
        if not svc_name:
            continue

        svc_uid = f"svc:{svc_name}"
        affected_services.add(svc_name)
        alert_uid = f"alert:am-{alertname}-{svc_name}".lower()

        if status == "firing":
            firing_uids.append(alert_uid)
            metric_name = labels.get("severity") or labels.get("alertname", "critical")
            summary = annotations.get("summary") or annotations.get("description") or alertname
            upsert(batch, "Alert", [{
                "uid": alert_uid,
                "id": alert_uid.removeprefix("alert:"),
                "metric": metric_name,
                "value": 1.0,
                "threshold": 0.0,
                "at": now,
                "status": "firing",
                "scenario": "alertmanager",
            }])
            # Link Alert -> Service
            link(batch, "Alert", "FIRED_ON", "Service", [(alert_uid, svc_uid)])
            # Mark the service degraded and root_fault=True if it alerts directly
            upsert(batch, "Service", [{
                "uid": svc_uid,
                "name": svc_name,
                "status": "degraded",
                "root_fault": True,
            }])
        else:
            resolved_uids.append(alert_uid)
            resolved_services.add(svc_name)
            upsert(batch, "Alert", [{
                "uid": alert_uid,
                "status": "resolved",
            }])

    batch.send(graph)

    # The monitoring system says it is over: a service with nothing else firing on it is healthy again. (Its callers recover below.)
    if resolved_services:
        still_firing = {e["to_id"].removeprefix("svc:") for a in graph.getVertices("Alert", select="status", where='status="firing"')
                        for e in graph.getEdges("Alert", a["v_id"], "FIRED_ON")}
        upsert(graph, "Service", [{"uid": f"svc:{n}", "status": "healthy", "root_fault": False}
                                  for n in sorted(resolved_services - still_firing)])

    recovered: list[str] = []
    resolved_alerts: list[str] = []
    if resolved_uids:
        health_res = recompute_health(graph)
        recovered = health_res.get("recovered", [])
        resolved_alerts = health_res.get("resolved_alerts", [])

    return {
        "received": len(alerts),
        "firing": firing_uids,
        "resolved": resolved_uids,
        "affected_services": sorted(affected_services),
        "recovered": recovered,
        "resolved_alerts": resolved_alerts,
    }
