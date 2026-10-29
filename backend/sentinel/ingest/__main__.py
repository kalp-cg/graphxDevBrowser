"""CLI: python -m sentinel.ingest sandbox | otlp FILE | monolith PATH   [--graph NAME]"""
import argparse
import json
from pathlib import Path

from ..config import settings
from ..db import get_graph
from ..schema import ensure_schema


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the SentinelGraph graph from a real or sandboxed system.")
    parser.add_argument("--graph", default=settings.tg_graph, help="graph name (default: %(default)s)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sb = sub.add_parser("sandbox", help="wipe the graph and load synthetic OpenTelemetry traffic")
    sb.add_argument("--mode", choices=["microservices", "monolith"], default="microservices")
    sb.add_argument("--fault", help="flag to switch on (e.g. paymentFailure, inventoryLockTimeout)")
    sb.add_argument("--requests", type=int, default=300)
    ot = sub.add_parser("otlp", help="ingest an OTLP/JSON trace export (one JSON object per line)")
    ot.add_argument("file", type=Path)
    ot.add_argument("--component", choices=["service", "module"], default="service")
    mo = sub.add_parser("monolith", help="modules, imports and git changes of a Python package")
    mo.add_argument("path", type=Path, help="the package directory")
    mo.add_argument("--repo", type=Path, help="git repository (default: the package's)")
    mo.add_argument("--depth", type=int, default=2, help="module depth: 2 = pkg.sub")
    mo.add_argument("--since", default="30 days ago")
    args = parser.parse_args()

    graph = get_graph(args.graph)
    if args.cmd == "sandbox":
        from .sandbox import load

        out = load(graph, args.mode, args.fault, args.requests)
    elif args.cmd == "otlp":
        from .otel import ingest_traces

        ensure_schema(graph)
        out = [ingest_traces(graph, json.loads(line), args.component)
               for line in args.file.read_text().splitlines() if line.strip()]
    else:
        from .monolith import git_changes, import_graph, write_modules

        ensure_schema(graph)
        modules, edges = import_graph(args.path, args.depth)
        changes = git_changes(args.repo or args.path, args.path, args.depth, args.since)
        out = write_modules(graph, modules, edges, changes)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
