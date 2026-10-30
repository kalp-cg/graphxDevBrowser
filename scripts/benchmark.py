#!/usr/bin/env python3
"""Score the codebase scanner against ground truth.

  python scripts/benchmark.py                                  the built-in corpus (backend/benchmark/corpus.py)
  python scripts/benchmark.py --repo ~/code/shop --truth shop.json

shop.json is what YOU say the repository contains, written by hand from its docs and code:
  {"services": ["web", "api"], "databases": ["db"], "edges": [["web", "api"], ["api", "db"]]}
Prints precision (what it reported is right) and recall (it found everything) for services, databases and connections,
and lists what was missing or extra. Exit code 1 if any score is below --min (default 0.9).
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from benchmark.corpus import CASES, build, score  # noqa: E402
from sentinel.ingest.codebase import scan  # noqa: E402


def found(manifest: dict) -> dict[str, set]:
    return {"services": {s["name"] for s in manifest["services"]},
            "databases": {d["name"] for d in manifest["databases"]},
            "edges": {tuple(e) for e in manifest["dependencies"]}}


def report(name: str, manifest: dict, truth: dict[str, set], lowest: float) -> float:
    got, worst = found(manifest), 1.0
    print(f"\n{name}")
    for what in ("services", "databases", "edges"):
        p, r = score(truth[what], got[what])
        worst = min(worst, p, r)
        flag = "" if min(p, r) >= lowest else "   <-- below the bar"
        print(f"  {what:<10} precision {p:5.2f}  recall {r:5.2f}   ({len(truth[what])} expected, {len(got[what])} found){flag}")
        for label, items in (("missing", truth[what] - got[what]), ("extra", got[what] - truth[what])):
            if items:
                print(f"      {label}: {', '.join(sorted(map(str, items)))}")
    return worst


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", type=Path)
    ap.add_argument("--truth", type=Path)
    ap.add_argument("--min", type=float, default=0.9, dest="lowest")
    args = ap.parse_args()
    worst = 1.0
    if args.repo:
        if not args.truth:
            ap.error("--repo needs --truth")
        t = json.loads(args.truth.read_text())
        truth = {"services": set(t.get("services", [])), "databases": set(t.get("databases", [])),
                 "edges": {tuple(e) for e in t.get("edges", [])}}
        worst = report(str(args.repo), scan(args.repo), truth, args.lowest)
    else:
        for case in CASES:
            with tempfile.TemporaryDirectory() as d:
                worst = min(worst, report(case.name, scan(build(case, Path(d))),
                                          {"services": case.services, "databases": case.databases, "edges": case.edges}, args.lowest))
    print(f"\nlowest score: {worst:.2f}   (bar {args.lowest:.2f})")
    return 0 if worst >= args.lowest else 1


if __name__ == "__main__":
    raise SystemExit(main())
