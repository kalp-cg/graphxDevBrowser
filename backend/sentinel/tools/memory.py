"""Memory tools: recall past incidents by graph proximity, not text similarity."""
from ..db import Graph, flat, run
from .common import check_services, graph_or_default, result
from .read import reach

# Everything an incident is linked to, in one pass. The root cause is a Service or a Deployment; for a
# Deployment the service it was deployed to is the root-cause service. `status` "" means every incident.
INCIDENTS_GSQL = """
INTERPRET QUERY (STRING status) FOR GRAPH $graphname SYNTAX v2 {
  SetAccum<STRING> @affected, @fixes, @actions, @similar_out, @similar_any;
  MinAccum<STRING> @rc_uid, @rc_service, @runbook_uid, @runbook, @runbook_steps;
  I = {Incident.*};
  I = SELECT i FROM I:i WHERE status == "" OR i.status == status;
  X = SELECT i FROM I:i -(AFFECTED>)- Service:s ACCUM i.@affected += s.name;
  X = SELECT i FROM I:i -(ROOT_CAUSE>)- Service:s ACCUM i.@rc_uid += s.uid, i.@rc_service += s.name;
  X = SELECT i FROM I:i -(ROOT_CAUSE>)- Deployment:d -(DEPLOYED_TO>)- Service:s
      ACCUM i.@rc_uid += d.uid, i.@rc_service += s.name;
  X = SELECT i FROM I:i -(RESOLVED_BY>)- Action:a ACCUM i.@fixes += a.kind, i.@actions += a.kind + "|" + a.status;
  X = SELECT i FROM I:i -(FOLLOWED>)- Runbook:r
      ACCUM i.@runbook_uid += r.uid, i.@runbook += r.title, i.@runbook_steps += r.steps;
  X = SELECT i FROM I:i -(SIMILAR_TO>)- Incident:o ACCUM i.@similar_out += o.id, i.@similar_any += o.id;
  X = SELECT i FROM I:i -(<SIMILAR_TO)- Incident:o ACCUM i.@similar_any += o.id;
  PRINT I;
}
"""


def incidents(g: Graph, status: str = "") -> list[dict]:
    found = flat(run(g, INCIDENTS_GSQL, {"status": status}, query_name="sentinel_incidents")["I"])
    for r in found:
        # A fix is an action that ran. Proposed, rejected or expired actions are part of the record, not the cure.
        r["fixes"] = sorted({kind for kind, status in (a.split("|", 1) for a in r["actions"]) if status == "executed"})
        r["root_cause_uid"], r["root_cause_service"] = r.pop("rc_uid"), r.pop("rc_service")
        for k in ("root_cause_uid", "root_cause_service", "runbook_uid", "runbook", "runbook_steps", "summary"):
            r[k] = r.get(k) or None
    return found


# A past incident is relevant if it touched a service these services depend on (<= 2 hops downstream,
# where failures come from) or the services themselves. Each touched service adds weight / (1 + hops):
# a root-cause link (direct, or via the deployment that caused it) weighs 2, an AFFECTED link 1.
def recall_similar(services: list[str], graph: Graph | None = None) -> dict:
    """Resolved past incidents near these services (themselves or <= 2 hops downstream), best match first."""
    g = graph_or_default(graph)
    names = sorted(set(services or []))
    if not names:
        return {"error": "bad_request", "message": "pass at least one service name"}
    if err := check_services(g, names):
        return err
    near = {n: min(r["dist"].values()) for n, r in reach(g, names, "down", 2).items()}
    found = []
    for i in incidents(g, "resolved"):
        touched = set(i["affected"]) | ({i["root_cause_service"]} if i["root_cause_service"] else set())
        via = sorted(n for n in touched if n in near)
        if not via:
            continue
        score = sum((2.0 if n == i["root_cause_service"] else 1.0) / (1 + near[n]) for n in via)
        found.append({
            "id": i["id"], "uid": i["uid"], "title": i["title"], "severity": i["severity"], "summary": i["summary"],
            "steps_taken": i["steps_taken"], "root_cause_uid": i["root_cause_uid"],
            "root_cause_service": i["root_cause_service"], "fixes": sorted(i["fixes"]),
            "runbook_uid": i["runbook_uid"], "runbook": i["runbook"], "runbook_steps": i["runbook_steps"],
            "similar_to": sorted(i["similar_any"]), "via": via, "score": round(score, 3),
        })
    found.sort(key=lambda r: r["id"], reverse=True)
    found.sort(key=lambda r: -r["score"])  # stable: equal scores stay newest id first
    found = found[:5]
    uids = [u for r in found for u in (r["uid"], r["root_cause_uid"], r["runbook_uid"]) if u]
    return result({"services": names, "incidents": found}, INCIDENTS_GSQL, uids)
