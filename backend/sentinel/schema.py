"""TigerGraph schema for SentinelGraph: one graph, local vertex/edge types, created on demand.

Every vertex's primary id is its stable `uid` (`svc:checkout-api`, `dep:inventory-db-proxy:v4.2.0`, ...).
Every edge has a reverse edge (`reverse_<NAME>`) so GSQL can walk it against the arrow.
"""
from pyTigerGraph import TigerGraphConnection

VERTICES = {
    "Team": "name STRING, domain STRING, slack_channel STRING",
    "Person": "handle STRING, name STRING, role STRING",
    "Service": "name STRING, tier STRING, layer STRING, language STRING, version STRING, status STRING, "
               "revenue_per_min INT, root_fault BOOL, kind STRING",
    "Database": "name STRING, engine STRING, size_gb INT, status STRING",
    "Deployment": "id STRING, version STRING, at INT, status STRING, change_summary STRING, origin STRING",
    "Commit": "sha STRING, message STRING, files_changed INT, files STRING",
    "Alert": "id STRING, metric STRING, value DOUBLE, threshold DOUBLE, at INT, status STRING, scenario STRING",
    "Incident": "id STRING, title STRING, severity STRING, status STRING, opened_at INT, resolved_at INT, "
                "summary STRING, steps_taken INT, learned BOOL, run_id STRING, root_cause_service STRING",
    "Runbook": "title STRING, steps STRING",
    "Action": "kind STRING, status STRING, target_name STRING, target_uid STRING, reason STRING, risk STRING, "
              "created_at INT, executed_at INT, approved_by STRING, outcome STRING, run_id STRING, summary STRING",
    "Page": "at INT, message STRING, channel STRING",
}

# name -> (FROM/TO pairs, attributes)
EDGES = {
    "OWNS": ("FROM Team, TO Service | FROM Team, TO Database", ""),
    "MEMBER_OF": ("FROM Person, TO Team", ""),
    "ON_CALL": ("FROM Person, TO Team", "from_ms INT, to_ms INT"),
    "DEPENDS_ON": ("FROM Service, TO Service", "uid STRING, protocol STRING, weight INT, latency_ms INT, "
                                               "breaker STRING"),
    "READS_FROM": ("FROM Service, TO Database", "uid STRING"),
    "WRITES_TO": ("FROM Service, TO Database", "uid STRING"),
    "DEPLOYED_TO": ("FROM Deployment, TO Service", ""),
    "CONTAINS": ("FROM Deployment, TO Commit", ""),
    "AUTHORED_BY": ("FROM Commit, TO Person", ""),
    "FIRED_ON": ("FROM Alert, TO Service", ""),
    "TRIGGERED_BY": ("FROM Incident, TO Alert", ""),
    "AFFECTED": ("FROM Incident, TO Service", ""),
    "ROOT_CAUSE": ("FROM Incident, TO Deployment | FROM Incident, TO Service", ""),
    "RESOLVED_BY": ("FROM Incident, TO Action", ""),
    "SIMILAR_TO": ("FROM Incident, TO Incident", "score DOUBLE, reason STRING"),
    "FOLLOWED": ("FROM Incident, TO Runbook", ""),
    "PAGED": ("FROM Incident, TO Page", ""),
    "APPLIES_TO": ("FROM Runbook, TO Service", ""),
    "TARGETS": ("FROM Action, TO Service | FROM Action, TO Deployment", ""),
    "NOTIFIED": ("FROM Page, TO Person", ""),
}

# uid prefix -> vertex type, for the places that hold "any node" by uid (ROOT_CAUSE, TARGETS).
UID_TYPES = {"svc": "Service", "dep": "Deployment", "db": "Database", "team": "Team", "person": "Person",
             "commit": "Commit", "alert": "Alert", "inc": "Incident", "rb": "Runbook", "act": "Action",
             "page": "Page"}


# Every forward edge type, as a GSQL v2 pattern alternative (skips the reverse_* edges).
FORWARD_EDGES = "|".join(f"{name}>" for name in EDGES)


def vertex_type(uid: str) -> str:
    return UID_TYPES[uid.split(":", 1)[0]]


def schema_job(graph: str) -> str:
    adds = [f"ADD VERTEX {name} (PRIMARY_ID uid STRING, {attrs}) WITH primary_id_as_attribute=\"true\";"
            for name, attrs in VERTICES.items()]
    for name, (pairs, attrs) in EDGES.items():
        body = pairs + (f", {attrs}" if attrs else "")
        adds.append(f"ADD DIRECTED EDGE {name} ({body}) WITH REVERSE_EDGE=\"reverse_{name}\";")
    lines = "\n  ".join(adds)
    return (f"USE GRAPH {graph}\nCREATE SCHEMA_CHANGE JOB sentinel_schema FOR GRAPH {graph} {{\n  {lines}\n}}\n"
            f"RUN SCHEMA_CHANGE JOB sentinel_schema\nDROP JOB sentinel_schema")


def ensure_schema(conn: TigerGraphConnection) -> bool:
    """Create the graph and its local schema if they don't exist yet. Returns True if it created anything.

    Only ever touches `conn.graphname`; other graphs on the same instance are left alone.
    """
    graph = conn.graphname
    if f"Graph {graph}(" in str(conn.gsql("SHOW GRAPH *")):
        if "Service" in str(conn.gsql(f"USE GRAPH {graph}\nSHOW VERTEX *")):
            return False
    else:
        out = str(conn.gsql(f"CREATE GRAPH {graph}()"))
        if "created" not in out.lower():
            raise RuntimeError(f"could not create graph {graph}: {out}")
    out = str(conn.gsql(schema_job(graph)))
    if "fail" in out.lower() or "error" in out.lower():
        raise RuntimeError(f"schema change failed on {graph}: {out}")
    return True
