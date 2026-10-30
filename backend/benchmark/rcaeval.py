"""Does SentinelGraph name the right root cause on real, labelled failures it has never seen?

RCAEval (https://github.com/phamquiluan/RCAEval, Hugging Face `phamquiluan/RCAEval`) is a public benchmark: real microservice
systems (Online Boutique, Sock Shop, Train Ticket) with faults injected on a known service (CPU, memory, disk, network delay,
packet loss, socket exhaustion), recorded as metrics, logs and traces. Each case says which service was broken.

Everything that decides the answer is the product's own code; this file only replays recorded telemetry into it the way a collector
would, and scores the result against the label:

  traces   the minutes before the fault, then the first DETECT_AFTER_S seconds after it, as OTLP batches (`ingest/otel.py`):
           topology, error rate, and latency against each service's learned normal
  metrics  the same window as time series (`ingest/metrics.py`)
  both     the two together, which is how it runs for a user

then `find_root_causes` names the root. Top-1 and top-3 are compared with two baselines that use no graph: the service with the
strongest metric anomaly, and a random guess. Repetition 1 of each fault was the development set; the held-out numbers use the
other repetitions.

Needs `pandas pyarrow` (not in requirements.txt: this is a benchmark, not the product). Downloads one case at a time and deletes it.
"""
import json
import os
import random
import shutil
import sys
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path

import pandas as pd

HF = "https://huggingface.co/datasets/phamquiluan/RCAEval/resolve/main"
SOURCES = ("traces", "metrics", "both")
DETECT_AFTER_S = 300      # the fault is noticed this long after it starts
BATCH_S = 60              # a collector's flush interval


def fetch(case: str, name: str, dest: Path) -> Path:
    out = dest / name
    with urllib.request.urlopen(f"{HF}/{case}/{name}", timeout=120) as r, open(out, "wb") as f:
        shutil.copyfileobj(r, f)
    return out


def norm(service: str) -> str:
    return "frontend" if service == "frontendservice" else service


def metric_payload(m: pd.DataFrame, end: int) -> dict:
    m = m[m.time < end]
    series = []
    for col in m.columns:
        if col != "time":
            series.append({"service": col.rsplit("_", 1)[0], "metric": col.rsplit("_", 1)[1],
                           "points": list(zip(m.time.tolist(), [None if v != v else v for v in m[col].tolist()]))})
    return {"series": series, "recent_seconds": DETECT_AFTER_S}


def run_case(case: dict, graph, tmp: Path) -> dict:
    from sentinel import baselines
    from sentinel.db import Batch, upsert
    from sentinel.ingest import metrics as metrics_ingest
    from sentinel.ingest import otel
    from sentinel.schema import ensure_schema
    from sentinel.seed.generator import wipe
    from sentinel.tools import rootcause

    name = case["case"]
    d = tmp / name
    d.mkdir(parents=True, exist_ok=True)
    inject = int(fetch(name, "inject_time.txt", d).read_text().strip())
    m = pd.read_parquet(fetch(name, "metrics.parquet", d))
    tr = pd.read_parquet(fetch(name, "traces.parquet", d))
    shutil.rmtree(d, ignore_errors=True)
    tr = tr.dropna(subset=["startTime", "serviceName", "traceID", "spanID"]).fillna({"statusCode": 0, "parentSpanID": "", "duration": 0})
    tr = tr.astype({"startTime": "int64", "statusCode": "int64", "duration": "int64"})

    end = inject + DETECT_AFTER_S
    sec = tr["startTime"] // 10**6
    tr = tr[sec < end]
    sec = sec[sec < end]
    bucket = ((sec - sec.min()) // BATCH_S).tolist()
    by_bucket: dict[int, list] = defaultdict(list)
    for b, r in zip(bucket, tr.itertuples(index=False)):
        by_bucket[b].append(otel.Span(trace=r.traceID, id=r.spanID, parent=r.parentSpanID, component=norm(r.serviceName), kind=0,
                                      error=bool(r.statusCode), ms=r.duration / 1000, attrs={}))
    t0 = int(sec.min())
    payload = metric_payload(m, end)
    known = sorted({s["service"] for s in payload["series"]})

    ranked, flagged = {}, {}
    for source in SOURCES:
        baselines.save("RCAEval", {})
        wipe(graph)
        ensure_schema(graph)
        if source in ("traces", "both"):
            for b in sorted(by_bucket):
                otel.ingest_spans(graph, by_bucket[b], at=(t0 + (b + 1) * BATCH_S) * 1000)
        if source in ("metrics", "both"):
            metrics_ingest.ingest_metrics(graph, payload, at=end * 1000)
        names = sorted(v["attributes"]["name"] for v in graph.getVertices("Service", select="name,status")
                       if v["attributes"].get("status") not in (None, "healthy"))
        flagged[source] = names
        ranked[source] = [r["name"] for r in rootcause.find_root_causes(names, graph).get("result", {}).get("roots", [])] if names else []
    z = metrics_ingest.analyze(payload)
    no_graph = [s for s, v in sorted(z.items(), key=lambda kv: -kv[1]["z"]) if v["z"] > 0]
    return {"case": name, "truth": case["root_cause_service"], "fault": case["fault"], "rep": int(case["repetition"]),
            "services": len(known), "flagged": flagged, "graph": ranked, "no_graph": no_graph}


def summarize(results: list[dict], reps: set[int] | None = None) -> dict:
    rows = [r for r in results if reps is None or r["rep"] in reps]
    n = len(rows)
    if not n:
        return {"cases": 0}
    out = {"cases": n, "random_top1": round(sum(1 / r["services"] for r in rows) / n, 3),
           "random_top3": round(sum(min(3, r["services"]) / r["services"] for r in rows) / n, 3),
           "no_graph(strongest metric anomaly)": {
               "top1": round(sum(r["no_graph"][:1] == [r["truth"]] for r in rows) / n, 3),
               "top3": round(sum(r["truth"] in r["no_graph"][:3] for r in rows) / n, 3)}}
    for source in SOURCES:
        out[source] = {"detected_anything": round(sum(bool(r["flagged"][source]) for r in rows) / n, 3),
                       "top1": round(sum(r["graph"][source][:1] == [r["truth"]] for r in rows) / n, 3),
                       "top3": round(sum(r["truth"] in r["graph"][source][:3] for r in rows) / n, 3)}
    out["top3_by_fault(both)"] = {f: round(sum(r["truth"] in r["graph"]["both"][:3] for r in sub) / len(sub), 2)
                                  for f in sorted({r["fault"] for r in rows}) for sub in [[r for r in rows if r["fault"] == f]]}
    return out


def main() -> None:
    dataset = sys.argv[1] if len(sys.argv) > 1 else "RE2-OB"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    store = Path(os.getenv("RCA_OUT", "/tmp/rcaeval-results"))
    store.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="rcaeval-"))
    os.environ["GRAPH_BACKEND"] = "local"
    os.environ["LOCAL_GRAPH_DIR"] = str(work / "graph")
    os.environ.setdefault("OTEL_RECOVERY_MS", "0")
    from sentinel.db import get_graph
    from sentinel.schema import ensure_schema

    graph = get_graph("RCAEval")
    ensure_schema(graph)
    index = pd.read_parquet(urllib.request.urlretrieve(f"{HF}/cases.parquet", work / "cases.parquet")[0])
    cases = index[index.dataset == dataset].to_dict("records")
    random.Random(1).shuffle(cases)
    if limit:
        cases = cases[:limit]
    out_file = store / f"{dataset}.jsonl"
    done = {json.loads(l)["case"] for l in out_file.read_text().splitlines()} if out_file.exists() else set()
    for i, c in enumerate(cases, 1):
        if c["case"] in done:
            continue
        try:
            r = run_case(c, graph, work)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(cases)}] {c['case']} FAILED: {exc!r}", flush=True)
            continue
        with open(out_file, "a") as f:
            f.write(json.dumps(r) + "\n")
        print(f"[{i}/{len(cases)}] {c['case']}: truth={r['truth']} traces={r['graph']['traces'][:3]} "
              f"metrics={r['graph']['metrics'][:3]} both={r['graph']['both'][:3]}", flush=True)
    results = [json.loads(l) for l in out_file.read_text().splitlines()] if out_file.exists() else []
    if not results:
        raise SystemExit("no case completed")
    print(json.dumps({"all": summarize(results), "heldout(rep 2,3)": summarize(results, {2, 3})}, indent=1))
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
