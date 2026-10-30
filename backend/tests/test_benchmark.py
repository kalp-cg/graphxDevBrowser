"""The scanner against hand-written ground truth (benchmark/corpus.py)."""
import pytest

from benchmark.corpus import CASES, build, score
from sentinel.ingest import codebase


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.name)
def test_the_scan_matches_what_a_person_reads_in_the_repository(case, tmp_path):
    m = codebase.scan(build(case, tmp_path))
    found_services = {s["name"] for s in m["services"] if s.get("kind") != "external"} | \
        {s["name"] for s in m["services"] if s.get("kind") == "external"}
    found_dbs = {d["name"] for d in m["databases"]}
    found_edges = {tuple(e) for e in m["dependencies"]}
    for what, truth, found in (("services", case.services, found_services), ("databases", case.databases, found_dbs),
                               ("connections", case.edges, found_edges)):
        p, r = score(truth, found)
        assert (p, r) == (1.0, 1.0), f"{case.name}: {what} precision {p:.2f} recall {r:.2f}\n  missing {sorted(truth - found)}\n  extra {sorted(found - truth)}"
    assert set(m["ignored"]) == case.ignored


def test_the_scoring_is_what_it_says():
    assert score({"a", "b"}, {"a", "b"}) == (1.0, 1.0)
    assert score({"a", "b"}, {"a"}) == (1.0, 0.5)          # found only a: right, but incomplete
    assert score({"a"}, {"a", "x", "y"}) == (1 / 3, 1.0)   # found everything, plus noise
    assert score(set(), set()) == (1.0, 1.0)
    assert score({"a"}, set()) == (0.0, 0.0)


def test_the_real_sample_shop_matches_its_hand_written_truth():
    import json
    from pathlib import Path

    shop = Path(__file__).resolve().parents[2] / "sandbox" / "shop"
    t = json.loads((Path(__file__).resolve().parents[1] / "benchmark" / "truth" / "shop.json").read_text())
    m = codebase.scan(shop)
    got = {"services": {s["name"] for s in m["services"]}, "databases": {d["name"] for d in m["databases"]},
           "edges": {tuple(e) for e in m["dependencies"]}}
    for what, truth in (("services", set(t["services"])), ("databases", set(t["databases"])), ("edges", {tuple(e) for e in t["edges"]})):
        assert score(truth, got[what]) == (1.0, 1.0), f"{what}: missing {sorted(truth - got[what])} extra {sorted(got[what] - truth)}"
