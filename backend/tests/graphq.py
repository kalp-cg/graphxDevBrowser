"""Read helpers for assertions (REST++ reads against the test graph)."""
from sentinel.db import Graph
from sentinel.schema import VERTICES


def vertices(g: Graph, vertex_type: str, where: str = "") -> list[dict]:
    return [{"uid": v["v_id"], **v["attributes"]} for v in g.getVertices(vertex_type, where=where)]


def all_uids(g: Graph) -> list[str]:
    return sorted(v["uid"] for t in VERTICES for v in vertices(g, t))


def counts(g: Graph) -> dict[str, int]:
    return {t: len(g.getVertices(t, select="")) for t in VERTICES}


def node_count(g: Graph) -> int:
    return sum(counts(g).values())


def unhealthy(g: Graph) -> set[str]:
    return {v["name"] for v in vertices(g, "Service", 'status!="healthy"')}


def firing(g: Graph) -> int:
    return len(vertices(g, "Alert", 'status="firing"'))


def firing_services(g: Graph) -> list[str]:
    return sorted(e["to_id"].removeprefix("svc:") for a in vertices(g, "Alert", 'status="firing"')
                  for e in g.getEdges("Alert", a["uid"], "FIRED_ON"))


def dependency_edges(g: Graph) -> list[dict]:
    return [e for s in vertices(g, "Service") for e in g.getEdges("Service", s["uid"], "DEPENDS_ON")]


def pages_to(g: Graph, handle: str) -> int:
    return len(g.getEdges("Person", f"person:{handle}", "reverse_NOTIFIED"))
