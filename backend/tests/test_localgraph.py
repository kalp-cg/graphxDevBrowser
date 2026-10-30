"""The embedded graph engine: parity with the GSQL in the codebase, and shared state across processes."""
import re
import subprocess
import sys
from pathlib import Path

import pytest

from sentinel import localgraph
from sentinel.localgraph import LocalGraph, _norm, _queries, _where

SRC = Path(__file__).resolve().parents[1] / "sentinel"


def gsql_in_codebase() -> list[str]:
    """Every interpreted query string in the package, with reach's {EDGE} expanded both ways."""
    from sentinel.tools.read import DIRECTIONS

    found = []
    for f in SRC.rglob("*.py"):
        if f.name == "localgraph.py":
            continue
        for q in re.findall(r'"""\s*(INTERPRET QUERY.*?)"""', f.read_text(), re.S):
            if "{FORWARD}" in q:
                from sentinel.schema import FORWARD_EDGES

                q = q.replace("{FORWARD}", FORWARD_EDGES)
            found += [q.replace("{EDGE}", e) for e in DIRECTIONS.values()] if "{EDGE}" in q else [q]
    return found


def test_every_gsql_query_has_a_local_implementation():
    queries = gsql_in_codebase()
    assert len(queries) >= 16
    missing = [q[:80] for q in queries if _norm(q) not in _queries()]
    assert not missing, f"add these to localgraph._queries(): {missing}"


def test_unknown_query_fails_loudly(tmp_path):
    g = LocalGraph("T", tmp_path / "t.json")
    with pytest.raises(NotImplementedError):
        g.runInterpretedQuery("INTERPRET QUERY () FOR GRAPH $graphname { PRINT 1; }")


def test_upserts_reads_and_reverse_edges(tmp_path):
    g = LocalGraph("T", tmp_path / "t.json")
    g.upsertVertices("Service", [("svc:a", {"name": "a", "tier": "critical"}), ("svc:b", {"name": "b"})])
    g.upsertEdges("Service", "DEPENDS_ON", "Service", [("svc:a", "svc:b", {"uid": "e:a->b"}),
                                                       ("svc:a", "svc:missing", {})], vertexMustExist=True)
    assert [v["attributes"]["status"] for v in g.getVertices("Service")] == ["", ""]  # TigerGraph defaults
    assert [v["v_id"] for v in g.getVertices("Service", where='tier="critical"')] == ["svc:a"]
    assert [v["v_id"] for v in g.getVertices("Service", where='tier!="critical",name="b"')] == ["svc:b"]
    (rev,) = g.getEdges("Service", "svc:b", "reverse_DEPENDS_ON")
    assert rev["to_id"] == "svc:a" and rev["attributes"]["uid"] == "e:a->b" and rev["attributes"]["breaker"] == ""
    assert g.getVerticesById("Service", "svc:nope") == []
    g.delEdges("Service", "svc:a", "DEPENDS_ON")
    assert g.getEdges("Service", "svc:a", "DEPENDS_ON") == []


def test_where_clause_parsing():
    assert _where('status!="healthy"')({"status": "down"})
    assert not _where('kind="rollback",status="pending"')({"kind": "rollback", "status": "executed"})
    assert _where('at>=5')({"at": 7}) and not _where("at<5")({"at": 7})
    assert _where('message="a, b"')({"message": "a, b"})  # commas inside quotes are not separators
    with pytest.raises(ValueError):
        _where("status ~ x")


def test_betweenness_matches_brute_force(tmp_path):
    """A diamond plus a tail: b and c each carry half of a's paths to d; d carries everything to e."""
    g = LocalGraph("T", tmp_path / "t.json")
    names = "abcde"
    g.upsertVertices("Service", [(f"svc:{n}", {"name": n}) for n in names])
    edges = [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"), ("d", "e")]
    g.upsertEdges("Service", "DEPENDS_ON", "Service", [(f"svc:{x}", f"svc:{y}", {"uid": f"e:{x}->{y}"})
                                                       for x, y in edges])
    from sentinel.tools.algorithms import BETWEENNESS_GSQL

    (out,) = g.runInterpretedQuery(BETWEENNESS_GSQL)
    score = {r["attributes"]["name"]: r["attributes"]["score"] for r in out["All"]}
    # Brute force: for every (s, t), share of shortest s->t paths through v.
    assert score == pytest.approx({"a": 0.0, "b": 1.0, "c": 1.0, "d": 3.0, "e": 0.0})


def test_state_is_shared_across_processes(tmp_path):
    """The MCP tool server is a subprocess: what it writes, the API process must read."""
    path = tmp_path / "shared.json"
    g = LocalGraph("T", path)
    g.upsertVertices("Service", [("svc:a", {"name": "a", "status": "healthy"})])
    code = (f"from sentinel.localgraph import LocalGraph; "
            f"LocalGraph('T', {str(path)!r}).upsertVertices('Service', [('svc:a', {{'status': 'down'}})])")
    subprocess.run([sys.executable, "-c", code], check=True, cwd=SRC.parent)
    assert g.getVerticesById("Service", "svc:a")[0]["attributes"]["status"] == "down"


def test_write_queries_are_registered():
    names = {impl.__name__ for impl in _queries().values()}
    assert localgraph.WRITE_QUERIES <= names
