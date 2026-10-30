"""The inside of a monolith: its modules, how they import each other, and what they call outside.

A repository with one deployable (a Next.js app, a Django project, a Rails app) has one service and nothing to
see in a compose file. The structure that matters is inside it: which module talks to the database, which one
calls an AI API, which routes depend on which libraries. This reads it from the code, statically:

- Modules: a folder of source files (`lib/ai`, `api.documents` for `app/api/documents/**`, `components`).
- Module -> module: the imports between them (TypeScript/JavaScript, with `tsconfig` path aliases; Python).
- Module -> database or outside API: packages imported (`@prisma/client`, `openai`, `stripe`), environment variables
  read (`process.env.GEMINI_API_KEY`) and well-known API hosts called. Only what the code uses; an unused entry in
  `.env.example` is not a dependency.
"""
import json
import os
import re
from pathlib import Path
from typing import Any

JS_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
PY_EXT = (".py",)
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", "out", "coverage", "__pycache__", ".venv", "venv", "env",
             "tests", "test", "__tests__", "e2e", "scratch", "docs", "doc", "diagram", "migrations", "prisma", "public",
             "static", ".storage", "vendor", ".turbo", ".cache", "scripts", "storybook", ".github"}
MAX_FILES = 4000
MAX_BYTES = 1_000_000

# package -> (name, kind, engine). Databases link to a compose/k8s database with the same engine when there is one.
PACKAGES: dict[str, tuple[str, str, str]] = {
    "pg": ("postgres", "database", "postgresql"), "postgres": ("postgres", "database", "postgresql"),
    "psycopg2": ("postgres", "database", "postgresql"), "asyncpg": ("postgres", "database", "postgresql"),
    "mysql2": ("mysql", "database", "mysql"), "mysql": ("mysql", "database", "mysql"),
    "pymysql": ("mysql", "database", "mysql"),
    "mongodb": ("mongodb", "database", "mongodb"), "mongoose": ("mongodb", "database", "mongodb"),
    "pymongo": ("mongodb", "database", "mongodb"),
    "redis": ("redis", "database", "redis"), "ioredis": ("redis", "database", "redis"),
    "@qdrant/js-client-rest": ("qdrant", "database", "qdrant"), "qdrant_client": ("qdrant", "database", "qdrant"),
    "@upstash/redis": ("redis", "database", "redis"), "kafkajs": ("kafka", "database", "kafka"),
    "openai": ("openai-api", "external", ""), "@anthropic-ai/sdk": ("anthropic-api", "external", ""),
    "anthropic": ("anthropic-api", "external", ""),
    "@google/generative-ai": ("gemini-api", "external", ""), "@google/genai": ("gemini-api", "external", ""),
    "google.generativeai": ("gemini-api", "external", ""),
    "stripe": ("stripe-api", "external", ""), "@sendgrid/mail": ("sendgrid-api", "external", ""),
    "twilio": ("twilio-api", "external", ""), "@aws-sdk/client-s3": ("aws-s3", "external", ""),
    "boto3": ("aws", "external", ""), "resend": ("resend-api", "external", ""),
    "@supabase/supabase-js": ("supabase", "external", ""), "firebase": ("firebase", "external", ""),
    "firebase-admin": ("firebase", "external", ""), "@clerk/nextjs": ("clerk", "external", ""),
}
PRISMA_ENGINES = {"postgresql": "postgresql", "postgres": "postgresql", "mysql": "mysql", "sqlite": "sqlite",
                  "mongodb": "mongodb", "sqlserver": "sqlserver", "cockroachdb": "cockroachdb"}
ENV_PREFIXES: tuple[tuple[str, tuple[str, str, str]], ...] = (
    ("GEMINI", ("gemini-api", "external", "")), ("GOOGLE_GENERATIVE", ("gemini-api", "external", "")),
    ("OPENAI", ("openai-api", "external", "")), ("ANTHROPIC", ("anthropic-api", "external", "")),
    ("STRIPE", ("stripe-api", "external", "")), ("SENDGRID", ("sendgrid-api", "external", "")),
    ("TWILIO", ("twilio-api", "external", "")), ("RESEND", ("resend-api", "external", "")),
    ("QDRANT", ("qdrant", "database", "qdrant")), ("REDIS", ("redis", "database", "redis")),
    ("MONGO", ("mongodb", "database", "mongodb")), ("SUPABASE", ("supabase", "external", "")),
)
HOSTS = {"generativelanguage.googleapis.com": ("gemini-api", "external", ""), "api.openai.com": ("openai-api", "external", ""),
         "api.anthropic.com": ("anthropic-api", "external", ""), "api.stripe.com": ("stripe-api", "external", ""),
         "api.sendgrid.com": ("sendgrid-api", "external", ""), "api.twilio.com": ("twilio-api", "external", "")}

JS_IMPORT = re.compile(r"""(?:\bimport\s+(?:[^'"()]*?\s+from\s+)?|\bexport\s+[^'"()]*?\s+from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]""")
PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))", re.M)
ENV_USE = re.compile(r"""(?:process\.env\.|process\.env\[\s*['"]|os\.environ(?:\.get)?\s*[\[(]\s*['"]|os\.getenv\s*\(\s*['"]|env\(\s*['"])([A-Z][A-Z0-9_]+)""")
URL_HOST = re.compile(r"https?://([a-z0-9.-]+)", re.I)
TEST_FILE = re.compile(r"(\.(test|spec|stories)\.[jt]sx?$|(^|/)test_.*\.py$|_test\.py$|(^|/)conftest\.py$)")


def _is_test(rel: str) -> bool:
    return bool(TEST_FILE.search(rel))


def module_of(rel: str) -> str:
    """A file's module, by its folder: `app/api/documents/[id]/route.ts` -> `api.documents`, `lib/ai/agent.ts` ->
    `lib.ai`, `components/Navbar.tsx` -> `components`, `src/billing/models.py` -> `billing`."""
    parts = rel.split("/")
    if parts[0] == "src" and len(parts) > 1:
        parts = parts[1:]
    if len(parts) == 1:
        return "root"
    if parts[0] == "app" and len(parts) > 3 and parts[1] == "api":
        seg = parts[2]
        return "api" if seg.startswith("[") else f"api.{seg}"
    if parts[0] == "pages" and len(parts) > 3 and parts[1] == "api":
        return f"api.{parts[2].rsplit('.', 1)[0]}"
    if len(parts) == 2:
        return parts[0]
    return f"{parts[0]}.{parts[1]}"


def _source_files(root: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(root.rglob("*")):
        if len(out) >= MAX_FILES:
            break
        if not p.is_file() or p.suffix not in JS_EXT + PY_EXT:
            continue
        rel = p.relative_to(root).as_posix()
        if SKIP_DIRS & set(rel.split("/")[:-1]) or _is_test(rel) or p.name.endswith(".d.ts"):
            continue
        try:
            if p.stat().st_size > MAX_BYTES:
                continue
        except OSError:
            continue
        out.append(rel)
    return out


def _aliases(root: Path) -> list[tuple[str, str]]:
    """tsconfig `paths` as (prefix, directory) pairs; `@/*` -> `./src/*` or `./*` when there is no tsconfig."""
    found: list[tuple[str, str]] = []
    for name in ("tsconfig.json", "jsconfig.json"):
        f = root / name
        if f.exists():
            text = re.sub(r"^\s*//.*$|/\*.*?\*/", "", f.read_text(errors="ignore"), flags=re.M | re.S)
            text = re.sub(r",(\s*[}\]])", r"\1", text)
            try:
                opts = (json.loads(text).get("compilerOptions") or {})
            except json.JSONDecodeError:
                opts = {}
            base = (opts.get("baseUrl") or ".").strip("./")
            for key, targets in (opts.get("paths") or {}).items():
                if targets and key.endswith("*"):
                    found.append((key[:-1], "/".join(x for x in (base, targets[0].lstrip("./").rstrip("*")) if x)))
    if not found:
        found = [("@/", "src/" if (root / "src").is_dir() and not (root / "lib").is_dir() else ""), ("~/", "")]
    return found


def _resolve_js(root: Path, files: set[str], from_rel: str, spec: str, aliases: list[tuple[str, str]]) -> str | None:
    if spec.startswith("."):
        base = (Path(from_rel).parent / spec).as_posix()
    else:
        base = next((d + spec[len(prefix):] for prefix, d in aliases if spec.startswith(prefix)), None)
        if base is None:
            return None
    parts: list[str] = []
    for seg in base.split("/"):
        if seg == "..":
            if parts:
                parts.pop()
        elif seg not in ("", "."):
            parts.append(seg)
    base = "/".join(parts)
    for cand in [base] + [base + e for e in JS_EXT] + [f"{base}/index{e}" for e in JS_EXT]:
        if cand in files:
            return cand
    return None


def _prisma_engine(root: Path) -> str:
    f = root / "prisma" / "schema.prisma"
    if f.exists():
        m = re.search(r"datasource\s+\w+\s*\{[^}]*provider\s*=\s*\"(\w+)\"", f.read_text(errors="ignore"), re.S)
        if m:
            return PRISMA_ENGINES.get(m.group(1), m.group(1))
    return "postgresql"


def _package_root(spec: str) -> str:
    return "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]


def scan_modules(root: Path, min_modules: int = 2) -> dict[str, Any] | None:
    """Modules of the code under `root` and their dependencies, or None when there is no structure to show."""
    root = root.resolve()
    rels = _source_files(root)
    files = set(rels)
    if not rels:
        return None
    aliases = _aliases(root)
    py_tops = {r.split("/")[0] for r in rels if r.endswith(".py") and "/" in r}
    prisma_engine = _prisma_engine(root)

    modules: dict[str, dict[str, Any]] = {}
    deps: set[tuple[str, str]] = set()
    outside: dict[str, set[tuple[str, str, str]]] = {}
    for rel in rels:
        mod = module_of(rel)
        m = modules.setdefault(mod, {"name": mod, "files": 0, "path": "", "py": 0, "js": 0})
        m["files"] += 1
        m["py" if rel.endswith(".py") else "js"] += 1
        text = (root / rel).read_text(errors="ignore")
        ext = outside.setdefault(mod, set())
        if rel.endswith(PY_EXT):
            for a, b in PY_IMPORT.findall(text):
                for name in ([a] if a else [x.strip().split(" as ")[0] for x in b.split(",")]):
                    top = name.split(".")[0]
                    if top in py_tops:
                        target = next((r for r in (f"{name.replace('.', '/')}.py", f"{name.replace('.', '/')}/__init__.py")
                                       if r in files), None)
                        if target:
                            deps.add((mod, module_of(target)))
                    elif name in PACKAGES or top in PACKAGES:
                        ext.add(PACKAGES.get(name) or PACKAGES[top])
        else:
            for spec in JS_IMPORT.findall(text):
                target = _resolve_js(root, files, rel, spec, aliases)
                if target:
                    deps.add((mod, module_of(target)))
                    continue
                pkg = _package_root(spec)
                if pkg == "@prisma/client":
                    ext.add(("prisma-db", "database", prisma_engine))
                elif pkg in PACKAGES:
                    ext.add(PACKAGES[pkg])
        for var in set(ENV_USE.findall(text)):
            hit = next((v for prefix, v in ENV_PREFIXES if var.startswith(prefix)), None)
            if hit:
                ext.add(hit)
            elif var == "DATABASE_URL":
                ext.add(("prisma-db", "database", prisma_engine))
        for host in set(URL_HOST.findall(text)):
            if host.lower() in HOSTS:
                ext.add(HOSTS[host.lower()])
    for name, m in modules.items():
        dirs = [Path(r).parent.as_posix() for r in rels if module_of(r) == name]
        m["path"] = Path(os.path.commonpath(dirs)).as_posix() if dirs else ""
        m["path"] = "" if m["path"] == "." else m["path"]
    deps = {(a, b) for a, b in deps if a != b and a in modules and b in modules}
    modules = {n: m for n, m in modules.items() if n != "root" or m["files"] > 1}
    if len(modules) < min_modules:
        return None
    return {"modules": modules, "dependencies": deps,
            "outside": {m: sorted(v) for m, v in outside.items() if v and m in modules},
            "module_of": module_of}
