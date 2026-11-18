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
# Single-file components: their <script> imports are JavaScript imports.
COMPONENT_EXT = (".svelte", ".vue", ".astro")
JS_LIKE = JS_EXT + COMPONENT_EXT
PY_EXT = (".py",)
# Every other language: modules are still folders, but a file's dependencies cannot be read from its import lines (Swift and C# import
# whole modules, Java and Kotlin share a namespace), so they are read from the types it uses: see `_type_dependencies`.
OTHER_LANGUAGES = {".swift": "swift", ".kt": "kotlin", ".kts": "kotlin", ".java": "java", ".scala": "scala", ".go": "go",
                   ".rs": "rust", ".rb": "ruby", ".php": "php", ".cs": "csharp", ".fs": "fsharp", ".c": "c", ".h": "c",
                   ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".m": "objective-c", ".mm": "objective-c",
                   ".dart": "dart", ".ex": "elixir", ".exs": "elixir", ".lua": "lua", ".zig": "zig", ".hs": "haskell",
                   ".clj": "clojure", ".erl": "erlang"}
OTHER_EXT = tuple(OTHER_LANGUAGES)
TYPE_DECL = re.compile(r"\b(?:class|struct|enum|protocol|actor|interface|trait|object|record|type|typealias)\s+([A-Z][A-Za-z0-9_]{3,})")
CAPITALISED = re.compile(r"\b[A-Z][A-Za-z0-9_]{3,}\b")
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", "out", "coverage", "__pycache__", ".venv", "venv", "env",
             "tests", "test", "__tests__", "e2e", "scratch", "docs", "doc", "diagram", "migrations", "prisma", "public",
             "static", ".storage", "vendor", ".turbo", ".cache", "scripts", "storybook", ".github", "pods", "carthage", "deriveddata",
             ".build", "target", "obj", "bin", ".gradle", "xcuserdata", "uitests", "androidtest", "third_party", "thirdparty",
             "generated", "__generated__"}
MAX_FILES = 4000
MAX_BYTES = 1_000_000

# Database and data-store use in languages whose imports do not name an npm/PyPI package: (pattern, (name, kind, engine)).
# An empty engine links to the database the repository declares (compose, Kubernetes), when there is one.
CODE_STORES: tuple[tuple[re.Pattern[str], tuple[str, str, str]], ...] = tuple((re.compile(p), v) for p, v in (
    (r"jakarta\.persistence|javax\.persistence|org\.springframework\.data|org\.hibernate|java\.sql\.|org\.jooq", ("database", "database", "")),
    (r"\"database/sql\"|gorm\.io/|github\.com/jackc/pgx|github\.com/lib/pq|go\.mongodb\.org|github\.com/jmoiron/sqlx|entgo\.io",
     ("database", "database", "")),
    (r"github\.com/(redis/go-redis|go-redis/redis)", ("redis", "database", "redis")),
    (r"\bActiveRecord::|<\s*ApplicationRecord\b", ("database", "database", "")),
    (r"Microsoft\.EntityFrameworkCore|\bDbContext\b|Npgsql|Dapper", ("database", "database", "")),
    (r"Illuminate\\Database|\bextends\s+Model\b|\bDB::table", ("database", "database", "")),
    (r"\bsqlx::|\bdiesel::|\bsea_orm::|\brusqlite::", ("database", "database", "")),
    (r"\bimport\s+(GRDB|SQLite|CoreData|RealmSwift)\b|\bNSPersistentContainer\b", ("local-db", "database", "sqlite")),
    (r"androidx\.room\.|\bRoomDatabase\b|\bSQLiteOpenHelper\b", ("local-db", "database", "sqlite")),
    (r"\bEcto\.Repo\b|\bEcto\.Schema\b", ("database", "database", "")),
))

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
PY_RELATIVE = re.compile(r"^\s*from\s+(\.+)([\w.]*)\s+import\s+(?:\(([^)]*)\)|([\w ,*]+))", re.M)
# Where JVM and Android builds keep source: the folders below them are Java packages, not modules.
JVM_ROOTS = ("src/main/java", "src/main/kotlin", "src/main/scala", "app/src/main/java", "app/src/main/kotlin")
ENV_USE = re.compile(r"""(?:process\.env\.|process\.env\[\s*['"]|os\.environ(?:\.get)?\s*[\[(]\s*['"]|os\.getenv\s*\(\s*['"]|env\(\s*['"])([A-Z][A-Z0-9_]+)""")
URL_HOST = re.compile(r"https?://([a-z0-9.-]+)", re.I)
TEST_FILE = re.compile(r"(\.(test|spec|stories)\.[jt]sx?$|(^|/)test_.*\.py$|_test\.py$|(^|/)conftest\.py$|"
                       r"(Tests?|Spec|IT)\.(swift|kt|java|cs|scala|m)$|_test\.(go|rs|c|cc|cpp)$|(^|/)src/test/)")


def _is_test(rel: str) -> bool:
    return bool(TEST_FILE.search(rel))


def module_of(rel: str, prefix: str = "") -> str:
    """A file's module, by its folder: `app/api/documents/[id]/route.ts` -> `api.documents`, `lib/ai/agent.ts` ->
    `lib.ai`, `components/Navbar.tsx` -> `components`, `src/billing/models.py` -> `billing`."""
    if prefix and rel.startswith(prefix + "/"):
        rel = rel[len(prefix) + 1:]
    parts = rel.split("/")
    if parts[0] in ("src", "Sources", "Source") and len(parts) > 1:
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
    from .workspaces import walk
    out: list[str] = []
    for p in walk(root):
        if len(out) >= MAX_FILES:
            break
        if p.suffix not in JS_LIKE + PY_EXT + OTHER_EXT:
            continue
        rel = p.relative_to(root).as_posix()
        folders = [d.lower() for d in rel.split("/")[:-1]]
        if SKIP_DIRS & set(folders) or any(d.endswith(("tests", "test", "specs")) for d in folders) or _is_test(rel) \
                or p.name.endswith(".d.ts"):
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
    if any((root / f"svelte.config.{e}").exists() for e in ("js", "ts", "mjs", "cjs")) or (root / "src" / "lib").is_dir():
        found.append(("$lib/", "src/lib/"))  # SvelteKit's built-in alias
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
    for cand in [base] + [base + e for e in JS_LIKE] + [f"{base}/index{e}" for e in JS_LIKE]:
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


def dominant_language(root: Path) -> str:
    """The language most of the source here is written in, from file extensions ('' when there is no source)."""
    counts: dict[str, int] = {}
    for rel in _source_files(root):
        ext = "." + rel.rsplit(".", 1)[-1]
        lang = ("typescript" if ext in (".ts", ".tsx") else "javascript" if ext in JS_EXT else "python" if ext in PY_EXT
                else ext[1:] if ext in COMPONENT_EXT else OTHER_LANGUAGES.get(ext, ""))
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    return max(counts, key=counts.get) if counts else ""


def _wrapper(rels: list[str]) -> str:
    """The folder that holds everything (`bitchat/` in `bitchat/bitchat/Services/...`), so modules are what is inside it.
    For JVM code that is the source root plus the shared package (`src/main/java/org/acme/shop`)."""
    prefix = next((r for r in JVM_ROOTS if sum(x.startswith(r + "/") for x in rels) >= 0.6 * len(rels)), "")
    if prefix:
        rels = [r for r in rels if r.startswith(prefix + "/")]
    while True:
        inside = [r[len(prefix) + 1:] if prefix else r for r in rels]
        tops = {r.split("/")[0] for r in inside if "/" in r}
        loose = [r for r in inside if "/" not in r]
        if len(tops) != 1 or len(loose) > 1 or (tops & {"src", "Sources", "Source", "app", "lib"} and not prefix):
            return prefix
        prefix = f"{prefix}/{tops.pop()}" if prefix else tops.pop()


def _type_dependencies(root: Path, rels: list[str], mod_of: Any) -> set[tuple[str, str]]:
    """module -> module, for languages whose imports do not name files: module A depends on B when A's code uses a type that only B
    declares. Names declared in several modules are ambiguous and ignored."""
    declared: dict[str, set[str]] = {}
    texts: dict[str, str] = {}
    for rel in rels:
        if not rel.endswith(OTHER_EXT):
            continue
        texts[rel] = (root / rel).read_text(errors="ignore")
        for name in TYPE_DECL.findall(texts[rel]):
            declared.setdefault(name, set()).add(mod_of(rel))
    owner = {n: next(iter(m)) for n, m in declared.items() if len(m) == 1}
    deps: set[tuple[str, str]] = set()
    for rel, text in texts.items():
        mine = mod_of(rel)
        for name in set(CAPITALISED.findall(text)):
            if (other := owner.get(name)) and other != mine:
                deps.add((mine, other))
    return deps


def _flat_split(rels: list[str], mod_of: Any) -> Any:
    """One package holding nearly everything in a single folder (a Python library, a Go package): its files are the modules."""
    counts: dict[str, int] = {}
    for r in rels:
        counts[mod_of(r)] = counts.get(mod_of(r), 0) + 1
    real = {m: n for m, n in counts.items() if m != "root"}
    if len(real) >= 3 or not real:
        return mod_of
    big, n = max(real.items(), key=lambda kv: kv[1])
    if n < 6 or len({Path(r).parent for r in rels if mod_of(r) == big}) > 2:
        return mod_of

    def split(r: str) -> str:
        m = mod_of(r)
        stem = Path(r).stem.lstrip("_")
        return f"{m}.{stem}" if m == big and stem not in ("init", "index", "mod", "main", "lib", "") else m
    return split


def scan_modules(root: Path, min_modules: int = 2, components: dict[str, str] | None = None,
                 packages: dict[str, str] | None = None) -> dict[str, Any] | None:
    """Modules of the code under `root` and their dependencies, or None when there is no structure to show.

    `components` (name -> folder, from a declared workspace) fixes the modules: a file belongs to the component whose folder
    holds it. `packages` (package name -> component) resolves imports by package name between them."""
    root = root.resolve()
    rels = _source_files(root)
    if components is not None:
        ordered = sorted(((path.strip("/"), name) for name, path in components.items()), key=lambda x: -len(x[0]))

        def mod_of(r: str) -> str:  # type: ignore[misc]
            return next((name for path, name in ordered if not path or r == path or r.startswith(path + "/")), "")
        rels = [r for r in rels if mod_of(r)]
        prefix = ""
    else:
        if not rels:
            return None
        prefix = _wrapper(rels)
        mod_of = _flat_split(rels, lambda r: module_of(r, prefix))  # noqa: E731
    files = set(rels)
    aliases = _aliases(root)
    # Top-level Python packages and the folder they sit in: `pkg/` or `src/pkg/` (the src layout).
    py_roots: dict[str, str] = {}
    for r in rels:
        if r.endswith(".py") and "/" in r:
            parts = r.split("/")
            if parts[0] in ("src", "lib", "python") and len(parts) > 2:
                py_roots.setdefault(parts[1], parts[0] + "/")
            else:
                py_roots.setdefault(parts[0], "")

    def py_file(dotted: str, base: str = "") -> str | None:
        stem = (base + "/" if base else "") + dotted.replace(".", "/")
        return next((c for c in (f"{stem}.py", f"{stem}/__init__.py") if c in files), None)
    prisma_engine = _prisma_engine(root)

    modules: dict[str, dict[str, Any]] = {}
    if components is not None:
        modules = {n: {"name": n, "files": 0, "path": p.strip("/"), "py": 0, "js": 0} for n, p in components.items()}
    deps: set[tuple[str, str]] = set()
    outside: dict[str, set[tuple[str, str, str]]] = {}
    for rel in rels:
        mod = mod_of(rel)
        m = modules.setdefault(mod, {"name": mod, "files": 0, "path": "", "py": 0, "js": 0})
        m["files"] += 1
        m["py" if rel.endswith(".py") else "js"] += 1
        text = (root / rel).read_text(errors="ignore")
        ext = outside.setdefault(mod, set())
        if rel.endswith(OTHER_EXT):
            ext.update(v for pattern, v in CODE_STORES if pattern.search(text))
            continue  # module dependencies of these come from the types they use, below
        if rel.endswith(PY_EXT):
            for a, b in PY_IMPORT.findall(text):
                for name in ([a] if a else [x.strip().split(" as ")[0] for x in b.split(",")]):
                    top = name.split(".")[0]
                    if top in py_roots:
                        target = py_file(name, py_roots[top].rstrip("/"))
                        if target:
                            deps.add((mod, mod_of(target)))
                    elif name in PACKAGES or top in PACKAGES:
                        ext.add(PACKAGES.get(name) or PACKAGES[top])
            here = Path(rel).parent
            for dots, name, wrapped, plain in PY_RELATIVE.findall(text):  # from .models import X / from .. import (a, b)
                imported = wrapped or plain
                base = here
                for _ in range(len(dots) - 1):
                    base = base.parent
                base_s = "" if base.as_posix() == "." else base.as_posix()
                targets = [py_file(name, base_s)] if name else [py_file(n.strip().split(" as ")[0], base_s)
                                                                for n in imported.replace("\n", ",").split(",") if n.strip()]
                deps |= {(mod, mod_of(t)) for t in targets if t}
        else:
            for spec in JS_IMPORT.findall(text):
                target = _resolve_js(root, files, rel, spec, aliases)
                if target:
                    deps.add((mod, mod_of(target)))
                    continue
                pkg = _package_root(spec)
                if packages and pkg in packages:
                    deps.add((mod, packages[pkg]))
                    continue
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
        if components is not None:
            continue  # a component's folder is the one its manifest names
        dirs = [Path(r).parent.as_posix() for r in rels if mod_of(r) == name]
        m["path"] = Path(os.path.commonpath(dirs)).as_posix() if dirs else ""
        m["path"] = "" if m["path"] == "." else m["path"]
    deps |= _type_dependencies(root, rels, mod_of)
    deps = {(a, b) for a, b in deps if a != b and a in modules and b in modules}
    modules = {n: m for n, m in modules.items() if n != "root" or m["files"] > 1}
    if len(modules) < min_modules:
        return None
    return {"modules": modules, "dependencies": deps,
            "outside": {m: sorted(v) for m, v in outside.items() if v and m in modules},
            "module_of": mod_of, "prefix": prefix}
