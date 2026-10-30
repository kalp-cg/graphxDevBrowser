"""Root-cause tools: what do the failing services share, and what changed there recently."""
from ..db import Graph, flat, run
from .common import capped, check_services, clamp, graph_or_default, now_ms, result
from .read import path_edges, reach, reach_gsql

MAX_HOPS = 5


def unhealthy_names(g: Graph) -> list[str]:
    return [v["attributes"]["name"] for v in g.getVertices("Service", select="name", where='status!="healthy"')]


def find_common_cause(services: list[str], graph: Graph | None = None) -> dict:
    """Services that ALL the given services depend on (including themselves), unhealthy and nearest first.

    Two GSQL breadth-first searches: down DEPENDS_ON from every alerting service (candidates = reached by all
    of them), and up DEPENDS_ON from every unhealthy service (how many unhealthy services sit below each
    candidate). Rank: unhealthy with nothing unhealthy below it (the deepest failure) > unhealthy but explained
    by an unhealthy dependency (a symptom) > healthy. Then down before degraded, then nearest.
    """
    g = graph_or_default(graph)
    names = sorted(set(services or []))
    if not names:
        return {"error": "bad_request", "message": "pass at least one service name"}
    if err := check_services(g, names):
        return err
    down = reach(g, names, "down", MAX_HOPS)
    below = reach(g, unhealthy_names(g), "up", MAX_HOPS)
    candidates = []
    for name, d in down.items():
        if len(d["dist"]) != len(names):
            continue
        under = sum(1 for src, hops in below.get(name, {}).get("dist", {}).items() if hops > 0)
        rank = 0 if d["status"] == "healthy" else 2 if under == 0 else 1
        candidates.append({
            "name": name, "uid": d["uid"], "status": d["status"], "tier": d["tier"],
            "max_hops": max(d["dist"].values()), "total_hops": sum(d["dist"].values()),
            "unhealthy_below": under, "likely_root_cause": rank == 2,
            "_key": (-rank, d["status"] != "down", max(d["dist"].values()), sum(d["dist"].values()), name),
        })
    candidates.sort(key=lambda c: c.pop("_key"))
    candidates = candidates[:5]
    # Other deepest failures anywhere (unhealthy, nothing unhealthy beneath) that the top candidate does not account
    # for: with them, "everything depends on X" is not the whole story.
    other_failures: list[str] = []
    if candidates and candidates[0]["likely_root_cause"]:
        top_below = {s for s, h in below.get(candidates[0]["name"], {}).get("dist", {}).items() if h >= 0}
        other_failures = sorted(
            n for n in unhealthy_names(g)
            if n != candidates[0]["name"] and n not in top_below
            and not any(h > 0 for h in below.get(n, {}).get("dist", {}).values()))
    node_uids = [f"svc:{n}" for n in names]
    edge_uids: list[str] = []
    if candidates:
        # Light up the path from each alerting service to the top candidate.
        top = candidates[0]
        for n in names:
            path = path_edges(down, n, top["name"], "down")
            edge_uids += path
            node_uids += [f"svc:{e.split('->')[1]}" for e in path]
        node_uids.append(top["uid"])
    node_uids += [f"svc:{n}" for n in other_failures]
    return result({"services": names, "candidates": candidates, "other_failures": other_failures},
                  reach_gsql("down"), node_uids, edge_uids)


def find_root_causes(services: list[str], graph: Graph | None = None) -> dict:
    """The independent failures behind these alerting services, for when they share no dependency.

    For each alerting service: the unhealthy services at or below it that have nothing unhealthy beneath them (a
    deepest failure). Alerting services that reach the same deepest failure are explained by it; services that
    reach different ones are separate incidents. `independent` is true when there is more than one failure.
    Each root lists the alerting services it explains, most first.
    """
    g = graph_or_default(graph)
    names = sorted(set(services or []))
    if not names:
        return {"error": "bad_request", "message": "pass at least one service name"}
    if err := check_services(g, names):
        return err
    below = reach(g, unhealthy_names(g), "up", MAX_HOPS)
    roots: dict[str, dict] = {}
    node_uids = [f"svc:{n}" for n in names]
    edge_uids: list[str] = []
    for n in names:
        down = reach(g, [n], "down", MAX_HOPS)
        for name, d in down.items():
            if d["status"] == "healthy" or sum(1 for _s, h in below.get(name, {}).get("dist", {}).items() if h > 0):
                continue  # healthy, or itself explained by something unhealthy beneath it
            r = roots.setdefault(name, {"name": name, "uid": d["uid"], "status": d["status"], "tier": d["tier"],
                                        "explains": [], "likely_root_cause": True})
            r["explains"].append(n)
            path = path_edges(down, n, name, "down")
            edge_uids += path
            node_uids += [f"svc:{e.split('->')[1]}" for e in path]
    ranked = sorted(roots.values(), key=lambda r: (-len(r["explains"]), r["status"] != "down", r["name"]))
    independent = len(ranked) > 1
    return result({"services": names, "roots": ranked, "independent": independent}, reach_gsql("down"),
                  node_uids + [r["uid"] for r in ranked], edge_uids)


RECENT_CHANGES_GSQL = """
INTERPRET QUERY (SET<STRING> services, INT since) FOR GRAPH $graphname SYNTAX v2 {
  MinAccum<STRING> @service, @commit_uid, @sha, @message, @author, @author_uid, @author_team;
  S = {Service.*};
  S = SELECT s FROM S:s WHERE s.name IN services;
  D = SELECT d FROM S:s -(<DEPLOYED_TO)- Deployment:d WHERE d.at >= since ACCUM d.@service += s.name;
  X = SELECT d FROM D:d -(CONTAINS>)- Commit:c
      ACCUM d.@commit_uid += c.uid, d.@sha += c.sha, d.@message += c.message;
  X = SELECT d FROM D:d -(CONTAINS>)- Commit:c -(AUTHORED_BY>)- Person:p
      ACCUM d.@author += p.name, d.@author_uid += p.uid;
  X = SELECT d FROM D:d -(CONTAINS>)- Commit:c -(AUTHORED_BY>)- Person:p -(MEMBER_OF>)- Team:t
      ACCUM d.@author_team += t.name;
  PRINT D[D.version, D.at, D.status, D.@service, D.@commit_uid, D.@sha, D.@message, D.@author, D.@author_uid,
          D.@author_team];
}
"""


def deployments(g: Graph, services: list[str], since: int = 0) -> list[dict]:
    """Deployments to these services since `since` (ms), newest first, with commit, author and team."""
    found = flat(run(g, RECENT_CHANGES_GSQL, {"services": services, "since": since}, query_name="sentinel_recent_changes")["D"])
    for r in found:
        for k in ("commit_uid", "sha", "message", "author", "author_uid", "author_team"):
            r[k] = r[k] or None
    return sorted(found, key=lambda r: (-r["at"], r["uid"]))


def recent_changes(services: list[str], minutes: int = 60, graph: Graph | None = None) -> dict:
    """Deployments to the given services in the last N minutes, with commit message and author."""
    g = graph_or_default(graph)
    names = sorted(set(services or []))
    if err := check_services(g, names):
        return err
    window = clamp(minutes, 1, 7 * 24 * 60, 60)
    now = now_ms()
    found = deployments(g, names, now - window * 60_000) if names else []
    for r in found:
        r["minutes_ago"] = round((now - r["at"]) / 60_000, 1)
    items, truncated = capped(found)
    uids = [u for r in found for u in (r["uid"], f"svc:{r['service']}", r["commit_uid"], r["author_uid"]) if u]
    return result({"services": names, "minutes": window, "changes": items}, RECENT_CHANGES_GSQL, uids,
                  truncated=truncated)
