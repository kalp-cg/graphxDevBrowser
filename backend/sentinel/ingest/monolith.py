"""A monolith as a graph: its modules are the components.

A monolith is one deployable, so "which service broke?" has one answer and tells you nothing. The question
moves inside it: which *module* is failing, and which *commit* changed it. The graph is the same as for
microservices, with modules as `Service {kind: 'module'}` vertices, so every agent tool works unchanged:

- Structure, statically: module -> module DEPENDS_ON from the imports in the code (Python, via `ast`).
- Structure and health at runtime: OpenTelemetry spans tagged with `code.namespace`
  (`ingest_traces(..., component="module")`, see otel.py).
- Changes: each git commit becomes a change deployed to every module whose files it touched, so
  `recent_changes` / `rollback` point at the commit that broke a module, not just "the last release".
"""
import ast
import subprocess
from pathlib import Path

from ..db import Batch, Graph, link, upsert
from .otel import record_change


def module_of(path: Path, root: Path, depth: int) -> str:
    """`root/pkg/sub/file.py` -> `pkg.sub` at depth 2 (the package path, cut to `depth` parts)."""
    parts = path.relative_to(root.parent).with_suffix("").parts
    parts = parts[:-1] if parts[-1] == "__init__" else parts
    return ".".join(parts[:depth])


def import_graph(root: Path, depth: int = 2) -> tuple[set[str], set[tuple[str, str]]]:
    """Modules of a Python package and the module -> module imports between them (internal imports only)."""
    root = root.resolve()
    pkg = root.name
    modules: set[str] = set()
    edges: set[tuple[str, str]] = set()
    for f in sorted(root.rglob("*.py")):
        src = module_of(f, root, depth)
        modules.add(src)
        here = f.relative_to(root.parent).with_suffix("").parts
        package = here[:-1]  # the package a relative import in this file is relative to
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"), str(f))):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = list(package[:len(package) - node.level + 1]) if node.level else []
                mod = ".".join(base + ([node.module] if node.module else []))
                targets = [mod] if node.module else [f"{mod}.{a.name}" for a in node.names]
            else:
                continue
            for t in targets:
                if t == pkg or t.startswith(pkg + "."):
                    dst = ".".join(t.split(".")[:depth])
                    if dst != src:
                        edges.add((src, dst))
    # Imports of names (`from pkg.mod import func`) resolve to modules that exist; drop anything else.
    return modules, {(a, b) for a, b in edges if b in modules}


def git_changes(repo: Path, root: Path, depth: int = 2, since: str = "30 days ago") -> list[dict]:
    """Commits that touched the package, each with the modules its files belong to (newest first)."""
    out = subprocess.run(
        ["git", "-C", str(repo), "log", f"--since={since}", "--name-only", "--format=@@%H|%an|%at|%s"],
        capture_output=True, text=True, check=True,
    ).stdout
    root, repo = root.resolve(), repo.resolve()
    changes = []
    for block in out.split("@@")[1:]:
        head, *files = [line for line in block.splitlines() if line.strip()]
        sha, author, at, subject = head.split("|", 3)
        touched = sorted({module_of(repo / f, root, depth) for f in files
                          if f.endswith(".py") and (repo / f).resolve().is_relative_to(root)})
        if touched:
            changes.append({"sha": sha[:10], "author": author, "at": int(at) * 1000, "message": subject,
                            "files": files, "modules": touched})
    return changes


def write_modules(graph: Graph, modules: set[str], edges: set[tuple[str, str]], changes: list[dict],
                  owners: dict[str, tuple[str, str]] | None = None) -> dict[str, int]:
    """Modules, their imports and their changes into the graph. `owners`: module -> (team, tier)."""
    owners = owners or {}
    batch = Batch()
    upsert(batch, "Service", [{"uid": f"svc:{m}", "name": m, "kind": "module", "layer": "module",
                               "language": "python", "status": "healthy", "root_fault": False,
                               **({"tier": owners[m][1]} if m in owners else {})} for m in sorted(modules)])
    teams = {t for t, _tier in owners.values()}
    upsert(batch, "Team", [{"uid": f"team:{t}", "name": t, "slack_channel": f"#team-{t}"} for t in teams])
    link(batch, "Team", "OWNS", "Service", [(f"team:{owners[m][0]}", f"svc:{m}") for m in modules if m in owners])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": "in-process", "weight": 1, "latency_ms": 0})
        for a, b in sorted(edges)
    ])
    for c in changes:
        for m in c["modules"]:
            if m in modules:
                record_change(batch, m, c["sha"][:7], c["at"], c["author"], c["message"], c["sha"], c["files"],
                              origin="git")
    batch.send(graph)
    return {"modules": len(modules), "imports": len(edges), "changes": len(changes)}
