#!/usr/bin/env python3
"""The codebase sandbox: does "Connect codebase" work on real repositories, of every shape?

Downloads a fixed set of public repositories (shallow clones, kept in sandbox/.codebases/, never run) and scans each one
exactly as DevBrowser's "Connect codebase" does. For each it checks the scan finishes, is fast enough, and finds a map that
says something: services and their connections for a multi-service system, modules and their imports for a single app.

  backend/.venv/bin/python sandbox/codebases.py            scan everything (clones on first run)
  backend/.venv/bin/python sandbox/codebases.py --only go   scan the repositories whose name contains "go"
  backend/.venv/bin/python sandbox/codebases.py --list      show the set

Exit code 1 if any repository fails its check. The results also go to sandbox/.codebases/results.json.
"""
import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sentinel.ingest.codebase import scan  # noqa: E402

CACHE = ROOT / "sandbox" / ".codebases"
MAX_SECONDS = 20.0


@dataclass
class Repo:
    name: str
    url: str
    shape: str            # what it is, in words
    expect: str           # "services": several deployables and their calls; "modules": one app and its insides; "none"
    min_nodes: int = 2    # services (or modules) the map must at least show


REPOS = [
    # Several services, declared for Docker Compose or Kubernetes, in many languages
    Repo("online-boutique", "https://github.com/GoogleCloudPlatform/microservices-demo", "Kubernetes, 11 services, 5 languages", "services", 10),
    Repo("otel-demo", "https://github.com/open-telemetry/opentelemetry-demo", "Docker Compose, 15+ services, 10 languages", "services", 10),
    Repo("voting-app", "https://github.com/dockersamples/example-voting-app", "Docker Compose: Python, Node, .NET, Redis, Postgres", "services", 3),
    Repo("petclinic-microservices", "https://github.com/spring-petclinic/spring-petclinic-microservices", "Docker Compose, Java Spring Cloud", "services", 5),
    Repo("fastapi-fullstack", "https://github.com/fastapi/full-stack-fastapi-template", "Docker Compose: FastAPI + React + Postgres", "services", 2),
    # One application: its modules and how they import each other
    Repo("petclinic", "https://github.com/spring-projects/spring-petclinic", "Java Spring Boot monolith (Maven)", "modules", 3),
    Repo("realworld-express", "https://github.com/gothinkster/node-express-realworld-example-app", "Node/TypeScript API monolith", "modules", 3),
    Repo("nextjs-taxonomy", "https://github.com/shadcn-ui/taxonomy", "Next.js app (App Router, Prisma, Stripe)", "modules", 3),
    Repo("django-site", "https://github.com/django/djangoproject.com", "Django website", "modules", 3),
    Repo("rails-realworld", "https://github.com/gothinkster/rails-realworld-example-app", "Ruby on Rails API", "modules", 2),
    Repo("laravel", "https://github.com/laravel/laravel", "PHP Laravel skeleton", "modules", 2),
    Repo("pocketbase", "https://github.com/pocketbase/pocketbase", "Go backend in one binary", "modules", 3),
    Repo("ripgrep", "https://github.com/BurntSushi/ripgrep", "Rust, a Cargo workspace of crates", "modules", 3),
    Repo("eshop-web", "https://github.com/dotnet-architecture/eShopOnWeb", "C# / .NET solution", "modules", 3),
    # Monorepos, mobile and libraries
    Repo("excalidraw", "https://github.com/excalidraw/excalidraw", "TypeScript monorepo (Yarn workspaces)", "modules", 3),
    Repo("now-in-android", "https://github.com/android/nowinandroid", "Kotlin Android app, many Gradle modules", "modules", 3),
    Repo("swift-argument-parser", "https://github.com/apple/swift-argument-parser", "Swift package", "modules", 2),
    Repo("requests", "https://github.com/psf/requests", "Python library", "modules", 2),
    Repo("svelte-realworld", "https://github.com/sveltejs/realworld", "SvelteKit app", "modules", 2),
    # Nothing to map: must say so, not crash
    Repo("gitignore-templates", "https://github.com/github/gitignore", "No source code at all", "none", 0),
]


def clone(repo: Repo) -> Path:
    dest = CACHE / repo.name
    if not (dest / ".git").is_dir():
        CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", "--depth", "40", "--single-branch", repo.url, str(dest)],
                       check=True, timeout=600)
    return dest


def check(repo: Repo, path: Path) -> dict:
    started = time.monotonic()
    try:
        manifest = scan(path)
    except ValueError as exc:  # the scanner's own "nothing to map here", with a reason
        return {"ok": repo.expect == "none", "seconds": round(time.monotonic() - started, 2), "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - a crash is the finding
        return {"ok": False, "seconds": round(time.monotonic() - started, 2), "error": f"{type(exc).__name__}: {exc}"}
    seconds = round(time.monotonic() - started, 2)
    nodes = len(manifest["services"])
    edges = len(manifest["dependencies"])
    found = {"seconds": seconds, "source": manifest["source"], "nodes": nodes, "databases": len(manifest["databases"]),
             "edges": edges, "changes": len(manifest["changes"]), "ignored": len(manifest["ignored"]),
             "languages": sorted({s.get("language") or "?" for s in manifest["services"]})[:6],
             "sample": [s["name"] for s in manifest["services"]][:8]}
    problems = []
    if repo.expect == "none":
        if nodes:
            problems.append(f"expected nothing to map, found {nodes}")
    else:
        if nodes < repo.min_nodes:
            problems.append(f"only {nodes} {repo.expect} (expected at least {repo.min_nodes})")
        if nodes > 1 and not edges:
            problems.append("no connections between them")
        if repo.expect == "services" and "code imports" in manifest["source"]:
            problems.append("read as one app, expected separate services")
    if seconds > MAX_SECONDS:
        problems.append(f"slow: {seconds}s")
    return {"ok": not problems, "problems": problems, **found}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="only repositories whose name contains this")
    parser.add_argument("--list", action="store_true", help="list the repositories and exit")
    args = parser.parse_args()
    repos = [r for r in REPOS if not args.only or args.only in r.name]
    if args.list:
        for r in repos:
            print(f"{r.name:24} {r.expect:9} {r.shape}")
        return 0

    results = {}
    print(f"{'repository':24} {'result':6} {'time':>6} {'found':40} detail")
    for r in repos:
        try:
            path = clone(r)
        except (subprocess.SubprocessError, OSError) as exc:
            results[r.name] = {"ok": False, "error": f"could not download: {exc}"}
            print(f"{r.name:24} {'SKIP':6} {'':>6} {'':40} could not download")
            continue
        res = results[r.name] = {"shape": r.shape, **check(r, path)}
        found = (f"{res['nodes']} {'modules' if '+' in res['source'] else 'services'}, {res['edges']} links, "
                 f"{res['databases']} db" if "nodes" in res else res.get("error", "")[:40])
        detail = "; ".join(res.get("problems") or []) or (res.get("source", "") + " · " + ", ".join(res.get("languages", [])))
        print(f"{r.name:24} {'ok' if res['ok'] else 'FAIL':6} {res['seconds']:>5}s {found:40} {detail}", flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "results.json").write_text(json.dumps(results, indent=2))
    failed = [n for n, r in results.items() if not r["ok"]]
    print(f"\n{len(results) - len(failed)} of {len(results)} repositories mapped as expected" +
          (f"; failed: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
