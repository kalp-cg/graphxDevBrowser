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
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import yaml

from ..db import Batch, Graph, link, upsert
from .modules import dominant_language, scan_modules
from .otel import record_change

COMPOSE_FILES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
DATA_STORES = {"zookeeper": "zookeeper", "dynamodb": "dynamodb", "kafka": "kafka", "rabbitmq": "rabbitmq", "nats": "nats", "postgres": "postgresql", "mysql": "mysql", "mariadb": "mysql", "mongo": "mongodb",
               "redis": "redis", "valkey": "redis", "memcached": "memcached", "elasticsearch": "elasticsearch",
               "opensearch": "elasticsearch", "cassandra": "cassandra", "clickhouse": "clickhouse",
               "cockroach": "cockroachdb"}
LANGUAGES = (("package.json", "javascript"), ("tsconfig.json", "typescript"), ("pyproject.toml", "python"),
             ("requirements.txt", "python"), ("go.mod", "go"), ("pom.xml", "java"), ("build.gradle", "java"),
             ("build.gradle.kts", "java"), ("Cargo.toml", "rust"), ("Gemfile", "ruby"), ("composer.json", "php"),
             ("mix.exs", "elixir"), ("CMakeLists.txt", "cpp"), ("*.csproj", "csharp"), ("*.fsproj", "fsharp"),
             ("*.slnx", "csharp"), ("*.sln", "csharp"), ("Directory.Build.props", "csharp"), ("Package.swift", "swift"),
             ("*.xcodeproj", "swift"), ("*.xcworkspace", "swift"), ("Podfile", "swift"), ("pubspec.yaml", "dart"),
             ("build.sbt", "scala"), ("setup.py", "python"), ("Pipfile", "python"), ("deno.json", "typescript"),
             ("stack.yaml", "haskell"), ("project.clj", "clojure"), ("settings.gradle", "java"), ("settings.gradle.kts", "java"),
             ("AndroidManifest.xml", "kotlin"))
DOCKER_BASES = (("golang", "go"), ("node", "javascript"), ("python", "python"), ("openjdk", "java"),
                ("eclipse-temurin", "java"), ("gradle", "java"), ("maven", "java"), ("rust", "rust"),
                ("ruby", "ruby"), ("php", "php"), ("dotnet", "csharp"), ("elixir", "elixir"), ("gcc", "cpp"))
SERVICE_DIRS = (".", "src", "services", "svc", "apps", "packages", "modules", "cmd", "microservices")
# Where a monorepo keeps a service's code when the compose file builds everything from the repo root.
CODE_ROOTS = ("src", "services", "apps", "packages", "cmd", "microservices", "")
# Services that observe or drive the system rather than being part of it. They are not services of the
# product, and an edge to them (every service exports telemetry) would put the whole system in every blast
# radius. Override per service with the label `sentinel.ignore: "true" | "false"`.
PLUMBING = re.compile(r"(otel-?collector|opentelemetry-collector|otelcol|jaeger|prometheus|grafana|loki|tempo|"
                      r"alertmanager|flagd|load-?gen|locust|k6$|traffic-?gen|zipkin|kafka-?(gui|ui)|kafdrop|pgadmin|adminer|"
                      r"mailhog|mailpit|(^|-)init$|(^|-)sim$|migrat)", re.I)
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


def _dotenv(repo: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        lines = (repo / ".env").read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        k, sep, v = line.strip().partition("=")
        if sep and k and not k.startswith("#"):
            out[k.removeprefix("export ").strip()] = v.strip().strip("\"'")
    return out


def _interpolate(text: str, env: dict[str, str]) -> str:
    """Docker Compose variable substitution: `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `$VAR`, `$$`."""
    def one(m: re.Match) -> str:
        if m.group(0) == "$$":
            return "$"
        name, default = m.group("name") or m.group("bare"), m.group("default")
        return env.get(name) or default or ""
    return re.sub(r"\$\$|\$\{(?P<name>\w+)(?::?-(?P<default>[^}]*))?\}|\$(?P<bare>[A-Za-z_]\w*)", one, text)


def _has(path: Path, marker: str) -> bool:
    return bool(next(path.glob(marker), None)) if "*" in marker else (path / marker).exists()


def _has_files(repo: Path) -> bool:
    """Is there anything in the folder besides hidden files and `.git`?"""
    return any(p.is_file() and not p.name.startswith(".") and ".git" not in p.relative_to(repo).parts[:1]
               for p in repo.rglob("*"))


def _language(path: Path, dockerfile: Path | None = None, deep: bool = True) -> str:
    """From manifests in the directory, then one level down (`src/cart/src/Cart.csproj`), then the Dockerfile's base image.
    `deep=False` looks only at the directory itself: a folder that merely contains services is not a service."""
    if path.is_dir():
        dirs = [path] + ([] if not deep else sorted(d for d in path.iterdir() if d.is_dir() and not d.name.startswith((".", "node_modules")))[:30])
        for d in dirs:
            for marker, lang in LANGUAGES:
                if _has(d, marker):
                    if lang == "javascript" and _has(d, "tsconfig.json"):
                        return "typescript"
                    return lang
    if dockerfile is None and (path / "Dockerfile").is_file():
        dockerfile = path / "Dockerfile"
    if dockerfile and dockerfile.is_file():
        for line in dockerfile.read_text(errors="ignore").splitlines():
            if line.strip().upper().startswith("FROM "):
                image = line.split()[1].lower().split("/")[-1]
                for base, lang in DOCKER_BASES:
                    if image.startswith(base):
                        return lang
    return ""


def _service_dir(repo: Path, name: str, context: str, dockerfile: str) -> str:
    """The directory holding a service's code. The build context when it is a subdirectory; otherwise (a monorepo
    that builds everything from the root) `src/<name>`-style folders, then the Dockerfile's folder."""
    def inside(rel: str) -> bool:
        p = (repo / rel).resolve()
        return p.is_dir() and p != repo and repo in p.parents

    if context and context not in (".", "./", "/") and inside(context):
        return Path(context).as_posix().removeprefix("./").rstrip("/")
    def looks_like_service(rel: str) -> bool:
        # `app/` in a Next.js repo is the page router, not the service called `app`: a service folder has a manifest
        # or a Dockerfile.
        return bool(_language(repo / rel)) or (repo / rel / "Dockerfile").is_file()

    for root in CODE_ROOTS:
        rel = f"{root}/{name}".strip("/")
        if inside(rel) and looks_like_service(rel):
            return rel
    # `spring-petclinic-api-gateway/` for the service `api-gateway`: a unique folder ending in the service name
    for root in CODE_ROOTS:
        base = repo / root if root else repo
        hits = [d.name for d in base.iterdir() if d.is_dir() and not d.name.startswith(".")
                and d.name.endswith(f"-{name}")] if base.is_dir() else []
        if len(hits) == 1 and looks_like_service(f"{root}/{hits[0]}".strip("/")):
            return f"{root}/{hits[0]}".strip("/")
    if dockerfile:
        parent = Path(dockerfile).parent.as_posix().removeprefix("./")
        if parent not in ("", ".") and inside(parent):
            return parent
    return ""


def _store(image: str, name: str) -> str | None:
    base = image.split("/")[-1].split(":")[0].lower() if image else name.lower()
    return next((engine for key, engine in DATA_STORES.items() if key in base), None)


def _store_name(name: str) -> str | None:
    """A data store by its name alone: `mysql`, `orders-db`, `session-cache` (for services built from a folder or
    images whose name says nothing)."""
    n = name.lower()
    if n in DATA_STORES:
        return DATA_STORES[n]
    if re.search(r"(^|-)(db|database|cache|queue)$", n):
        return next((e for k, e in DATA_STORES.items() if k in n), "database")
    if not re.search(r"service|api|worker|gateway|app|proxy|consumer|producer|client", n):
        return next((e for k, e in DATA_STORES.items() if len(k) >= 5 and n.startswith(k)), None)  # dynamodblocal
    return None


def _plumbing(name: str, image: str, labels: dict[str, str]) -> bool:
    flag = labels.get("sentinel.ignore", "").lower()
    if flag in ("true", "false"):
        return flag == "true"
    return bool(PLUMBING.search(name) or PLUMBING.search(image.split("/")[-1].split(":")[0]))


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


def _walk(node: Any, env: dict[str, str]) -> Any:
    """Variable substitution on every string of a parsed document (text-level substitution can break the YAML)."""
    if isinstance(node, str):
        return _interpolate(node, env)
    if isinstance(node, list):
        return [_walk(x, env) for x in node]
    if isinstance(node, dict):
        return {_walk(k, env): _walk(v, env) for k, v in node.items()}
    return node


COMPOSE_DIRS = ("deploy", "docker", "deployment", "deployments", "compose", "infra", "ops", "docker-compose")


def _find_compose(repo: Path) -> Path | None:
    """The repo's compose file: at the root, else one or two folders down in the usual places (`deploy/docker-compose/`)."""
    for name in COMPOSE_FILES:
        if (repo / name).is_file():
            return repo / name
    for d in COMPOSE_DIRS:
        for base in (repo / d, *sorted((repo / d).glob("*/"))[:10]):
            for name in COMPOSE_FILES:
                if (base / name).is_file():
                    return base / name
    return None


def _compose(repo: Path) -> tuple[dict[str, Any], Path] | None:
    path = _find_compose(repo)
    if path is None:
        return None
    env = {**_dotenv(repo), **_dotenv(path.parent)}
    text = path.read_text()
    try:
        doc = _walk(yaml.safe_load(text) or {}, env)  # substitute per value: `image: redis:${TAG}` with TAG unset stays valid
    except yaml.YAMLError:
        try:  # Compose substitutes before parsing, so `[A=${PORT}]` is valid for it though not for plain YAML
            doc = yaml.safe_load(_interpolate(text, env)) or {}
        except yaml.YAMLError as exc:
            raise ValueError(f"{path.relative_to(repo)} is not valid YAML: {str(exc).splitlines()[0]}") from exc
    return (doc if isinstance(doc, dict) else {}), path.parent


K8S_KINDS = ("Deployment", "StatefulSet", "DaemonSet")
K8S_SKIP = {".git", ".github", "node_modules", "vendor", "charts", "helm-chart", "terraform", "test", "tests"}


def _k8s_docs(repo: Path) -> list[dict]:
    docs = []
    for f in sorted(list(repo.rglob("*.yaml")) + list(repo.rglob("*.yml")))[:2000]:
        rel = f.relative_to(repo).parts
        if len(rel) > 5 or K8S_SKIP & set(rel[:-1]):
            continue
        text = f.read_text(errors="ignore")
        if "{{" in text or "kind:" not in text:  # Helm templates are not YAML until rendered
            continue
        try:
            docs += [d for d in yaml.safe_load_all(text) if isinstance(d, dict) and d.get("kind")]
        except yaml.YAMLError:
            continue
    return docs


def _kubernetes(repo: Path, rules: list[tuple[str, str]]) -> dict[str, Any] | None:
    """Services from Kubernetes manifests: a Deployment is a service, and `host:port` or URL values in its
    environment that name another Deployment or Service are its dependencies."""
    docs = _k8s_docs(repo)
    workloads: dict[str, dict] = {}
    for d in docs:
        if d["kind"] in K8S_KINDS:
            meta = d.get("metadata") or {}
            name = meta.get("name")
            pod = ((d.get("spec") or {}).get("template") or {}).get("spec") or {}
            containers = pod.get("containers") or []
            if not name or not containers:
                continue
            w = workloads.setdefault(name, {"labels": {}, "env": [], "image": "", "ports": set(), "selector": name})
            w["labels"].update({k: str(v) for k, v in (meta.get("labels") or {}).items()})
            w["image"] = w["image"] or str(containers[0].get("image", ""))
            for c in containers:
                w["env"] += [str(e.get("value", "")) for e in c.get("env") or [] if isinstance(e, dict)]
                w["ports"] |= {str(p["containerPort"]) for p in c.get("ports") or [] if "containerPort" in p}
            sel = ((d.get("spec") or {}).get("selector") or {}).get("matchLabels") or {}
            w["selector"] = str(sel.get("app") or sel.get("app.kubernetes.io/name") or name)
    if not workloads:
        return None
    svc_of: dict[str, str] = {}  # Kubernetes Service name -> workload
    published: set[str] = set()
    aliases: dict[str, str] = {}
    by_selector = {w["selector"]: n for n, w in workloads.items()}
    for d in docs:
        if d["kind"] != "Service":
            continue
        name = (d.get("metadata") or {}).get("name")
        spec = d.get("spec") or {}
        target = by_selector.get(str((spec.get("selector") or {}).get("app", ""))) or (name if name in workloads else None)
        if not (name and target):
            continue
        svc_of[name] = target
        if spec.get("type") in ("LoadBalancer", "NodePort"):
            published.add(target)
        for p in spec.get("ports") or []:
            aliases[f"{name}:{p.get('port')}"] = target
            if p.get("nodePort"):
                aliases[f"localhost:{p['nodePort']}"] = target
    services: dict[str, dict] = {}
    databases: dict[str, str] = {}
    ignored: list[str] = []
    for name, w in workloads.items():
        if _plumbing(name, w["image"], w["labels"]):
            ignored.append(name)
            continue
        engine = _store(w["image"], name) or _store_name(name)
        if engine and not _service_dir(repo, name, "", ""):
            databases[name] = engine
            continue
        rel = _service_dir(repo, name, "", "")
        tier = w["labels"].get("sentinel.tier", "medium")
        services[name] = {
            "name": name, "path": rel, "language": _language(repo / rel) if rel else "",
            "tier": tier if tier in TIERS else "medium",
            "revenue_per_min": int(w["labels"].get("sentinel.revenue_per_min", "0") or 0),
            "team": w["labels"].get("sentinel.team") or (_owner(rules, rel) if rel else None),
            "published": name in published, "layer": w["labels"].get("sentinel.layer")}
        aliases[name] = name
        for port in w["ports"]:
            aliases[f"{name}:{port}"] = name
    known = {**{n: n for n in workloads}, **svc_of}
    deps: set[tuple[str, str]] = set()
    for name, w in workloads.items():
        if name in ignored:
            continue
        for value in w["env"]:
            for host in re.findall(r"(?:://|@|^)([a-z0-9][a-z0-9.-]*)(?::\d+|/|$)", value.strip()):
                target = known.get(host.split(".")[0])
                if target and target != name and target not in ignored:
                    deps.add((name, target))
    return {"services": services, "databases": databases, "deps": deps, "aliases": aliases, "ignored": ignored}


def _dockerfile(repo: Path, context: str, dockerfile: str) -> Path | None:
    if not dockerfile:
        return None
    p = repo / context / dockerfile if context else repo / dockerfile
    return p if p.is_file() else None


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


def _git_module_changes(repo: Path, since: str, module_of: Any, names: set[str]) -> list[dict]:
    """Commits per module of a monolith: each file a commit touched belongs to one module."""
    try:
        out = subprocess.run(["git", "-C", str(repo), "log", f"--since={since}", "--name-only", "--format=@@%H|%an|%at|%s"],
                             capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    changes, count = [], {n: 0 for n in names}
    for block in out.split("@@")[1:]:
        head, *files = [line for line in block.splitlines() if line.strip()]
        sha, author, at, subject = head.split("|", 3)
        by_module: dict[str, list[str]] = {}
        for f in files:
            m = module_of(f)
            if m in names:
                by_module.setdefault(m, []).append(f)
        for m, touched in by_module.items():
            if count[m] < MAX_CHANGES_PER_SERVICE:
                count[m] += 1
                changes.append({"service": m, "sha": sha[:10], "author": author, "at": int(at) * 1000,
                                "message": subject, "files": touched})
    return changes


def _expand_monolith(repo: Path, services: dict[str, dict], databases: dict[str, str], deps: set[tuple[str, str]],
                     aliases: dict[str, str], rules: list[tuple[str, str]], since: str) -> dict[str, Any] | None:
    """One deployable built from the repo root: its modules are what there is to map. Replaces the single service by
    its modules, the imports between them, and what each one calls (databases, outside APIs)."""
    mono = next(iter(services.values()), None)
    if len(services) != 1 or mono is None or mono["path"]:
        return None
    found = scan_modules(repo)
    if not found:
        return None
    mods = found["modules"]
    if "root" in mods and len(mods) >= 4:
        mods = {n: m for n, m in mods.items() if n != "root"}  # config files at the repo root
    if len(mods) < 2:
        return None
    new_services: dict[str, dict] = {}
    for name, m in mods.items():
        entry = name == "app" or name.startswith(("api", "pages"))
        new_services[name] = {
            "name": name, "kind": "module", "path": m["path"], "published": False,
            "language": mono["language"] or ("python" if m["py"] > m["js"] else "javascript"),
            "tier": mono["tier"], "revenue_per_min": 0,
            "team": mono.get("team") or (_owner(rules, m["path"]) if m["path"] else None),
            "layer": mono["layer"] or ("edge" if entry else "business")}
    new_dbs = dict(databases)
    new_deps = {(a, b) for a, b in found["dependencies"] if a in new_services and b in new_services}
    reached: set[str] = set()
    for mod, outside in found["outside"].items():
        if mod not in new_services:
            continue
        for name, kind, engine in outside:
            if kind == "database":
                target = next((n for n, e in databases.items() if e == engine), None)
                if target is None:
                    target = name
                    new_dbs.setdefault(target, engine or "database")
                new_deps.add((mod, target))
                reached.add(target)
            else:
                new_services.setdefault(name, {"name": name, "kind": "external", "path": "", "language": "", "tier": "medium",
                                               "revenue_per_min": 0, "team": None, "published": False, "layer": "platform"})
                new_deps.add((mod, name))
    edge = [n for n, sv in new_services.items() if sv["layer"] == "edge" and sv["kind"] == "module"]
    for a, b in deps:  # what the compose file says the app depends on, when no module's code says it
        if a == mono["name"] and b in databases and b not in reached:
            new_deps |= {(m, b) for m in edge}
    entry = "app" if "app" in new_services else (edge[0] if edge else next(iter(new_services)))
    new_aliases = {k: (entry if v == mono["name"] else v) for k, v in aliases.items()}
    new_aliases[entry] = entry
    for address, target in aliases.items():  # `/api/orders/...` on the app's address is the module `api.orders`
        if target == mono["name"]:
            new_aliases.update({f"{address}/api/{m.split('.', 1)[1]}": m for m in new_services if m.startswith("api.")})
    changes = _git_module_changes(repo, since, found["module_of"], set(new_services))
    return {"services": new_services, "databases": new_dbs, "deps": new_deps, "aliases": new_aliases, "changes": changes,
            "prefix": found["prefix"]}


def scan(repo: Path, since: str = "30 days ago") -> dict[str, Any]:
    """Everything the repository declares about the system, as a manifest (plain JSON)."""
    repo = repo.resolve()
    rules = _owners(repo)
    services: dict[str, dict] = {}
    databases: dict[str, str] = {}
    deps: set[tuple[str, str]] = set()
    aliases: dict[str, str] = {}
    ignored: list[str] = []
    found = _compose(repo)
    compose, base = found if found else (None, repo)
    k8s = None if compose is not None else _kubernetes(repo, rules)

    def from_repo(rel: str) -> str:
        """A path in the compose file is relative to the compose file; the rest of the scan to the repo."""
        if not rel:
            return ""
        return os.path.relpath((base / rel).resolve(), repo)

    if compose is not None:
        specs = compose.get("services") or {}
        for name, spec in specs.items():
            spec = spec or {}
            build = spec.get("build")
            context = from_repo(str(build.get("context", ".") if isinstance(build, dict) else build or ""))
            dockerfile = str(build.get("dockerfile", "") if isinstance(build, dict) else "")
            labels = _as_dict(spec.get("labels"))
            if _plumbing(name, str(spec.get("image", "")), labels):
                ignored.append(name)
                continue
            engine = (_store(str(spec.get("image", "")), name) if not build else None) or _store_name(name)
            rel = "" if engine else _service_dir(repo, name, context, dockerfile)
            for published, target in _ports(spec.get("ports")):
                aliases[f"localhost:{published}"] = name
                aliases[f"{name}:{target}"] = name
            aliases[name] = name
            if engine:
                databases[name] = engine
                continue
            tier = labels.get("sentinel.tier", "medium")
            services[name] = {
                "name": name, "path": rel,
                "language": (_language(repo / rel, _dockerfile(repo, context, dockerfile))
                             if rel or dockerfile or (build and context in ("", ".")) else ""),
                "tier": tier if tier in TIERS else "medium",
                "revenue_per_min": int(labels.get("sentinel.revenue_per_min", "0") or 0),
                "team": labels.get("sentinel.team") or (_owner(rules, rel) if rel else None),
                "published": bool(_ports(spec.get("ports"))), "layer": labels.get("sentinel.layer"),
            }
        names = set(specs) - set(ignored)
        for name, spec in specs.items():
            if name not in services:
                continue
            spec = spec or {}
            on = spec.get("depends_on") or []
            targets = set(on if isinstance(on, list) else on.keys()) | {str(x).split(":")[0] for x in spec.get("links") or []}
            for value in _as_dict(spec.get("environment")).values():
                targets |= {h for h in re.findall(r"(?:://|@|^)([a-z0-9][a-z0-9_-]*)(?::\d+|/|$)", value) if h in names}
            deps |= {(name, t) for t in targets if t != name and t in names}
    elif k8s is not None:
        services, databases, deps = k8s["services"], k8s["databases"], k8s["deps"]
        aliases, ignored = k8s["aliases"], k8s["ignored"]
    else:
        for parent in SERVICE_DIRS:
            folder = repo / parent
            if not folder.is_dir():
                continue
            for d in sorted(folder.iterdir()):
                if parent == "." and d.name in CODE_ROOTS:
                    continue  # `src/` holds services, it is not one
                if d.is_dir() and not d.name.startswith(".") and (lang := _language(d, deep=False)):
                    rel = d.relative_to(repo).as_posix()
                    services[d.name] = {"name": d.name, "path": rel, "language": lang, "tier": "medium",
                                        "revenue_per_min": 0, "team": _owner(rules, rel), "published": False,
                                        "layer": None}

    if compose is None and k8s is None and not services and _has_files(repo):
        # No compose file and no services folders: the repository is one application, whatever it is written in. (A mobile app, a
        # library, a CLI, a monorepo with its own layout.) Never refuse: its modules are mapped below from the code.
        name = re.sub(r"[^a-z0-9-]+", "-", repo.name.lower()).strip("-") or "app"
        services[name] = {"name": name, "path": "", "language": _language(repo) or dominant_language(repo), "tier": "medium",
                          "revenue_per_min": 0,
                          "team": _owner(rules, ""), "published": False, "layer": None}
    expanded = _expand_monolith(repo, services, databases, deps, aliases, rules, since)
    if expanded:
        services, databases, deps = expanded["services"], expanded["databases"], expanded["deps"]
        aliases = expanded["aliases"]

    # Unless labelled: entry points (published, nothing in the repo calls them) are the edge, the rest business.
    called = {b for _a, b in deps}
    for s in services.values():
        published = s.pop("published")
        s["layer"] = s["layer"] or ("edge" if published and s["name"] not in called else "business")
    return {
        "repo": repo.name,
        "repo_path": str(repo),
        "services": sorted(services.values(), key=lambda s: s["name"]),
        "databases": [{"name": n, "engine": e} for n, e in sorted(databases.items())],
        "dependencies": sorted([a, b] for a, b in deps),
        "aliases": dict(sorted(aliases.items())),
        "ignored": sorted(ignored),
        "changes": (expanded["changes"] if expanded else
                    _git_changes(repo, {s["name"]: s["path"] for s in services.values()}, since)),
        "module_prefix": expanded["prefix"] if expanded else "",
        "source": ("docker-compose" if compose is not None else "kubernetes" if k8s is not None else "directories")
                  + (" + code imports" if expanded else ""),
    }


def apply(graph: Graph, manifest: dict[str, Any]) -> dict[str, Any]:
    """Write a manifest to the graph. New services start healthy; existing ones keep their runtime status."""
    existing = {v["v_id"] for v in graph.getVertices("Service", select="name")}
    svc_names = {s["name"] for s in manifest["services"]}
    db_names = {d["name"] for d in manifest["databases"]}
    batch = Batch()
    upsert(batch, "Service", [
        {"uid": f"svc:{s['name']}", "name": s["name"], "kind": s.get("kind", "service"), "tier": s["tier"], "layer": s["layer"],
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
    # A database is also a service of kind `database`: that is what lets it be unhealthy, be alerted on, and be the
    # root cause (every traversal runs over services). The map draws it as a database.
    callers = {d["name"]: [a for a, b in manifest["dependencies"] if b == d["name"] and a in svc_names]
               for d in manifest["databases"]}
    tiers = {s["name"]: s["tier"] for s in manifest["services"]}
    rank = {t: i for i, t in enumerate(TIERS)}
    upsert(batch, "Service", [
        {"uid": f"svc:{d['name']}", "name": d["name"], "kind": "database", "layer": "data", "language": d["engine"],
         "tier": min((tiers[c] for c in callers[d["name"]]), key=lambda t: rank.get(t, 9), default="medium"),
         "revenue_per_min": 0, **({} if f"svc:{d['name']}" in existing else {"status": "healthy", "root_fault": False})}
        for d in manifest["databases"]])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": "http", "weight": 1})
        for a, b in manifest["dependencies"] if a in svc_names and b in svc_names
    ])
    link(batch, "Service", "WRITES_TO", "Database", [
        (f"svc:{a}", f"db:{b}", {"uid": f"e:{a}-writes_to->{b}"})
        for a, b in manifest["dependencies"] if a in svc_names and b in db_names
    ])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{a}", f"svc:{b}", {"uid": f"e:{a}->{b}", "protocol": "sql", "weight": 1})
        for a, b in manifest["dependencies"] if a in svc_names and b in db_names
    ])
    for c in manifest["changes"]:
        if c["service"] in svc_names:
            record_change(batch, c["service"], c["sha"][:7], c["at"], c["author"], c["message"], c["sha"],
                          c["files"], origin="git")
    batch.send(graph)
    return {"services": len(svc_names), "databases": len(db_names), "dependencies": len(manifest["dependencies"]),
            "teams": len(teams), "changes": len(manifest["changes"]), "aliases": len(manifest["aliases"])}
