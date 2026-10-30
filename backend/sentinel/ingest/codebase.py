"""A codebase -> the graph: point SentinelGraph at a repository and it maps the system before any traffic.

`scan(repo)` reads what the repository already declares, nothing is configured by hand:

- Services, databases and their dependencies from Docker Compose (`depends_on`, `links`, and environment
  values that name another service, e.g. `INVENTORY_URL=http://inventory:8000`). Images of well-known data
  stores (postgres, mysql, mongo, redis, ...) become `Database` vertices.
- Every address a service answers on (published ports, `service:port`), so browser traffic to
  `localhost:7004` and traces from `checkout` land on the same vertex (see workspace.py).
- Ownership from CODEOWNERS (`@org/payments-team` owning `services/payments/` -> Team payments-team).
- Language from the files in each service's build context; tier and revenue from compose labels
  (`sentinel.tier: critical`, `sentinel.revenue_per_min: 1200`, `sentinel.layer: edge`, `sentinel.team`).
- Recent changes from git: each commit touching a service's directory is a change deployed to it.

Without a compose file, every directory under the repo root, `services/`, `apps/` or `packages/` with a
package manifest is a service; their dependencies then come from traces and browser traffic.

`apply(graph, manifest)` writes it. It never resets runtime state: a re-scan of a broken system leaves
statuses, alerts and incidents alone.
"""
import re
import subprocess
from pathlib import Path
from typing import Any

import yaml

from ..db import Batch, Graph, link, upsert
from .otel import record_change

COMPOSE_FILES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
DATA_STORES = {"postgres": "postgresql", "mysql": "mysql", "mariadb": "mysql", "mongo": "mongodb",
               "redis": "redis", "valkey": "redis", "memcached": "memcached", "elasticsearch": "elasticsearch",
               "opensearch": "elasticsearch", "cassandra": "cassandra", "clickhouse": "clickhouse",
               "cockroach": "cockroachdb"}
LANGUAGES = (("package.json", "javascript"), ("tsconfig.json", "typescript"), ("pyproject.toml", "python"),
             ("requirements.txt", "python"), ("go.mod", "go"), ("pom.xml", "java"), ("build.gradle", "java"),
             ("Cargo.toml", "rust"), ("Gemfile", "ruby"), ("composer.json", "php"))
SERVICE_DIRS = (".", "services", "apps", "packages")
TIERS = ("critical", "high", "medium", "low")
MAX_CHANGES_PER_SERVICE = 5


def _as_dict(value: Any) -> dict[str, str]:
    """Compose allows `KEY: value` maps and `KEY=value` lists for environment and labels."""
    if isinstance(value, dict):
        return {str(k): "" if v is None else str(v) for k, v in value.items()}
    out = {}
    for item in value or []:
        k, _, v = str(item).partition("=")
        out[k] = v
    return out


def _ports(spec: Any) -> list[tuple[str, str]]:
    """(published, target) pairs from compose `ports` (short `"7004:8000"` or long syntax)."""
    out = []
    for p in spec or []:
        if isinstance(p, dict):
            if p.get("published"):
                out.append((str(p["published"]), str(p.get("target", p["published"]))))
            continue
        parts = str(p).split("/")[0].split(":")
        if len(parts) == 1:
            out.append((parts[0], parts[0]))
        else:
            out.append((parts[-2], parts[-1]))  # ip:published:target or published:target
    return [(a, b) for a, b in out if a.isdigit() and b.isdigit()]


def _language(path: Path) -> str:
    for marker, lang in LANGUAGES:
        if (path / marker).exists():
            if lang == "javascript" and (path / "tsconfig.json").exists():
                return "typescript"
            return lang
    return ""


def _store(image: str, name: str) -> str | None:
    base = image.split("/")[-1].split(":")[0].lower() if image else name.lower()
    return next((engine for key, engine in DATA_STORES.items() if key in base), None)


def _owners(repo: Path) -> list[tuple[str, str]]:
    """CODEOWNERS rules (pattern, team), in file order; the last match wins, as on GitHub."""
    for p in (repo / "CODEOWNERS", repo / ".github" / "CODEOWNERS", repo / "docs" / "CODEOWNERS"):
        if p.exists():
            rules = []
            for line in p.read_text().splitlines():
                parts = line.split("#", 1)[0].split()
                if len(parts) >= 2 and parts[1].startswith("@"):
                    rules.append((parts[0], parts[1].lstrip("@").split("/")[-1]))
            return rules
    return []


def _owner(rules: list[tuple[str, str]], rel: str) -> str | None:
    """Team owning a directory: `/dir/` is anchored at the root, `dir/` matches at any depth, `*` everything."""
    team = None
    for pattern, owner in rules:
        p = pattern.strip("/").removesuffix("/**").removesuffix("/*")
        anchored = pattern.startswith("/")
        if pattern == "*" or rel == p or rel.startswith(p + "/") or (not anchored and f"/{p}/" in f"/{rel}/"):
            team = owner
    return team


def _compose(repo: Path) -> dict[str, Any] | None:
    for name in COMPOSE_FILES:
        if (repo / name).exists():
            return yaml.safe_load((repo / name).read_text()) or {}
    return None


def _git_changes(repo: Path, paths: dict[str, str], since: str) -> list[dict]:
    """Commits touching each service's directory (newest first, a few per service)."""
    try:
        out = subprocess.run(["git", "-C", str(repo), "log", f"--since={since}", "--name-only", "--relative",
                              "--format=@@%H|%an|%at|%s"], capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    changes, per_service = [], {s: 0 for s in paths}
    for block in out.split("@@")[1:]:
        head, *files = [line for line in block.splitlines() if line.strip()]
        sha, author, at, subject = head.split("|", 3)
        for svc, rel in paths.items():
            if rel in ("", ".") or per_service[svc] >= MAX_CHANGES_PER_SERVICE:
                continue
            touched = [f for f in files if f.startswith(rel.rstrip("/") + "/")]
            if touched:
                per_service[svc] += 1
                changes.append({"service": svc, "sha": sha[:10], "author": author, "at": int(at) * 1000,
                                "message": subject, "files": touched})
    return changes


def scan(repo: Path, since: str = "30 days ago") -> dict[str, Any]:
    """Everything the repository declares about the system, as a manifest (plain JSON)."""
    repo = repo.resolve()
    rules = _owners(repo)
    services: dict[str, dict] = {}
    databases: dict[str, str] = {}
    deps: set[tuple[str, str]] = set()
    aliases: dict[str, str] = {}
    compose = _compose(repo)

    if compose is not None:
        specs = compose.get("services") or {}
        for name, spec in specs.items():
            spec = spec or {}
            build = spec.get("build")
            context = build.get("context", ".") if isinstance(build, dict) else build
            rel = str(Path(context).as_posix()).removeprefix("./") if context else ""
            labels = _as_dict(spec.get("labels"))
            engine = _store(str(spec.get("image", "")), name) if not build else None
            for published, target in _ports(spec.get("ports")):
                aliases[f"localhost:{published}"] = name
                aliases[f"{name}:{target}"] = name
            aliases[name] = name
            if engine:
                databases[name] = engine
                continue
            tier = labels.get("sentinel.tier", "medium")
            services[name] = {
                "name": name, "path": rel, "language": _language(repo / rel) if rel else "",
                "tier": tier if tier in TIERS else "medium",
                "revenue_per_min": int(labels.get("sentinel.revenue_per_min", "0") or 0),
                "team": labels.get("sentinel.team") or (_owner(rules, rel) if rel else None),
                "published": bool(_ports(spec.get("ports"))), "layer": labels.get("sentinel.layer"),
            }
        names = set(specs)
        for name, spec in specs.items():
            if name not in services:
                continue
            spec = spec or {}
            on = spec.get("depends_on") or []
            targets = set(on if isinstance(on, list) else on.keys()) | {str(x).split(":")[0] for x in spec.get("links") or []}
            for value in _as_dict(spec.get("environment")).values():
                targets |= {h for h in re.findall(r"(?:://|@|^)([a-z0-9][a-z0-9_-]*)(?::\d+|/|$)", value) if h in names}
            deps |= {(name, t) for t in targets if t != name and t in names}
    else:
        for parent in SERVICE_DIRS:
            base = repo / parent
            if not base.is_dir():
                continue
            for d in sorted(base.iterdir()):
                if d.is_dir() and not d.name.startswith(".") and (lang := _language(d)):
                    rel = d.relative_to(repo).as_posix()
                    services[d.name] = {"name": d.name, "path": rel, "language": lang, "tier": "medium",
                                        "revenue_per_min": 0, "team": _owner(rules, rel), "published": False,
                                        "layer": None}

    # Unless labelled: entry points (published, nothing in the repo calls them) are the edge, the rest business.
    called = {b for _a, b in deps}
    for s in services.values():
        published = s.pop("published")
        s["layer"] = s["layer"] or ("edge" if published and s["name"] not in called else "business")
    return {
        "repo": repo.name,
        "services": sorted(services.values(), key=lambda s: s["name"]),
        "databases": [{"name": n, "engine": e} for n, e in sorted(databases.items())],
        "dependencies": sorted([a, b] for a, b in deps),
        "aliases": dict(sorted(aliases.items())),
        "changes": _git_changes(repo, {s["name"]: s["path"] for s in services.values()}, since),
        "source": "docker-compose" if compose is not None else "directories",
    }


def apply(graph: Graph, manifest: dict[str, Any]) -> dict[str, Any]:
    """Write a manifest to the graph. New services start healthy; existing ones keep their runtime status."""
    existing = {v["v_id"] for v in graph.getVertices("Service", select="name")}
    svc_names = {s["name"] for s in manifest["services"]}
    db_names = {d["name"] for d in manifest["databases"]}
    batch = Batch()
    upsert(batch, "Service", [
        {"uid": f"svc:{s['name']}", "name": s["name"], "kind": "service", "tier": s["tier"], "layer": s["layer"],
         "language": s["language"], "revenue_per_min": s["revenue_per_min"],
         **({} if f"svc:{s['name']}" in existing else {"status": "healthy", "root_fault": False})}
        for s in manifest["services"]
    ])
    teams = sorted({s["team"] for s in manifest["services"] if s.get("team")})
    upsert(batch, "Team", [{"uid": f"team:{t}", "name": t, "slack_channel": f"#{t}"} for t in teams])
    link(batch, "Team", "OWNS", "Service", [(f"team:{s['team']}", f"svc:{s['name']}")
                                            for s in manifest["services"] if s.get("team")])
    upsert(batch, "Database", [{"uid": f"db:{d['name']}", "name": d["name"], "engine": d["engine"],
                                "status": "healthy"} for d in manifest["databases"]])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": "http", "weight": 1})
        for a, b in manifest["dependencies"] if a in svc_names and b in svc_names
    ])
    link(batch, "Service", "WRITES_TO", "Database", [
        (f"svc:{a}", f"db:{b}", {"uid": f"e:{a}-writes_to->{b}"})
        for a, b in manifest["dependencies"] if a in svc_names and b in db_names
    ])
    for c in manifest["changes"]:
        if c["service"] in svc_names:
            record_change(batch, c["service"], c["sha"][:7], c["at"], c["author"], c["message"], c["sha"],
                          c["files"], origin="git")
    batch.send(graph)
    return {"services": len(svc_names), "databases": len(db_names), "dependencies": len(manifest["dependencies"]),
            "teams": len(teams), "changes": len(manifest["changes"]), "aliases": len(manifest["aliases"])}
