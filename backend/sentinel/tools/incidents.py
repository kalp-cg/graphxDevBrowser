"""Incident lifecycle: every investigation becomes an Incident node, i.e. memory for the next one."""
import re

from ..db import Graph, attrs, flat, link, run, upsert
from .common import graph_or_default, now_ms
from .read import firing_alerts
from .rootcause import deployments

RECENT_DEPLOY_MS = 2 * 60 * 60 * 1000


def next_incident_id(graph: Graph) -> str:
    ids = [v["attributes"]["id"] for v in graph.getVertices("Incident", select="id")]
    n = max((int(i[4:]) for i in ids if i[4:].isdigit()), default=0)
    return f"INC-{max(1000, n) + 1}"


def incident_for_run(graph: Graph, run_id: str) -> dict | None:
    found = graph.getVertices("Incident", where=f'run_id="{run_id}"') if re.fullmatch(r"[\w-]+", run_id or "") else []
    return {"uid": found[0]["v_id"], **found[0]["attributes"]} if found else None


def open_incident(run_id: str, graph: Graph | None = None) -> dict | None:
    """Create an `investigating` incident for the alerts firing now. None if nothing is firing."""
    g = graph_or_default(graph)
    firing = firing_alerts(g)
    if not firing:
        return None
    inc_id = next_incident_id(g)
    uid = f"inc:{inc_id}"
    services = sorted({f["service"] for f in firing})
    upsert(g, "Incident", [{"uid": uid, "id": inc_id, "title": "Alerts on " + ", ".join(services),
                            "severity": "SEV2", "status": "investigating", "opened_at": now_ms(), "run_id": run_id,
                            "learned": True, "steps_taken": 0}])
    link(g, "Incident", "TRIGGERED_BY", "Alert", [(uid, f["uid"]) for f in firing])
    link(g, "Incident", "AFFECTED", "Service", [(uid, f"svc:{s}") for s in services])
    return {"id": inc_id, "uid": uid, "services": services, "alerts": [f["uid"] for f in firing]}


def conclude_incident(run_id: str, root_cause_service: str, summary: str, steps_taken: int,
                      similar_to: str | None = None, graph: Graph | None = None) -> dict:
    """Record the root cause (the recent deploy on that service if there is one), summary and memory links."""
    g = graph_or_default(graph)
    inc = incident_for_run(g, run_id)
    if not inc:
        return {"error": "no_incident", "message": f"no incident for run {run_id}"}
    svc_uid = f"svc:{root_cause_service}"
    if not attrs(g, "Service", svc_uid):
        return {"error": "not_found", "message": f"No service named {root_cause_service!r}"}
    dep = deployments(g, [root_cause_service], now_ms() - RECENT_DEPLOY_MS)
    target, target_type = (dep[0]["uid"], "Deployment") if dep else (svc_uid, "Service")
    g.delEdges("Incident", inc["uid"], "ROOT_CAUSE")
    upsert(g, "Incident", [{"uid": inc["uid"], "summary": summary, "steps_taken": int(steps_taken),
                            "root_cause_service": root_cause_service, "title": f"{root_cause_service} failure",
                            "status": "resolved" if inc["status"] == "resolved" else "mitigating"}])
    link(g, "Incident", "ROOT_CAUSE", target_type, [(inc["uid"], target)])
    runbooks = g.getEdges("Service", svc_uid, "reverse_APPLIES_TO")
    link(g, "Incident", "FOLLOWED", "Runbook", [(inc["uid"], e["to_id"]) for e in runbooks])
    other = f"inc:{similar_to}" if similar_to else None
    if other and other != inc["uid"] and attrs(g, "Incident", other):
        link(g, "Incident", "SIMILAR_TO", "Incident",
             [(inc["uid"], other, {"score": 1.0, "reason": "same root cause service"})])
    return {"incident": inc["id"], "uid": inc["uid"], "root_cause_uid": target}


SETTLE_GSQL = """
INTERPRET QUERY (INT now) FOR GRAPH $graphname SYNTAX v2 {
  SumAccum<INT> @firing;
  I = {Incident.*};
  I = SELECT i FROM I:i -(TRIGGERED_BY>)- Alert:a WHERE i.status == "investigating" OR i.status == "mitigating"
      ACCUM IF a.status == "firing" THEN i.@firing += 1 END
      HAVING i.@firing == 0;
  X = SELECT i FROM I:i POST-ACCUM i.status = "resolved", i.resolved_at = now;
  PRINT I[I.id];
}
"""


def settle_incidents(graph: Graph | None = None) -> list[str]:
    """Mark incidents resolved once every alert that triggered them is resolved. Returns their ids."""
    g = graph_or_default(graph)
    return sorted(r["id"] for r in flat(run(g, SETTLE_GSQL, {"now": now_ms()}, query_name="sentinel_settle")["I"]))


def record_steps(run_id: str, steps: int, graph: Graph | None = None) -> None:
    """Store the final step count (the model may keep acting after it concluded)."""
    g = graph_or_default(graph)
    inc = incident_for_run(g, run_id)
    if inc:
        upsert(g, "Incident", [{"uid": inc["uid"], "steps_taken": int(steps)}])
