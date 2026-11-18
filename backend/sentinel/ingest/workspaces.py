"""The packages a monorepo declares, and which uses which, read from the build tool's own files.

A repository that is one product made of many packages says so in a manifest, and says which package depends on which:

- npm, Yarn and pnpm workspaces: `workspaces` in package.json, pnpm-workspace.yaml, lerna.json; dependencies by package name.
- Gradle (Android, Kotlin, Java): `include(":core:data")` in settings.gradle(.kts); `implementation(projects.core.data)` or
  `project(":core:data")` in each build file. Test-only dependencies are not part of the product and are left out.
- Swift Package Manager: the targets in Package.swift and their `dependencies:`.
- Cargo: `[workspace] members` and path / workspace dependencies between member crates.
- Maven: `<modules>` and dependencies on a sibling module's artifactId.
- .NET: every project file and its `<ProjectReference>`s.
- Go: the modules listed in go.work.

`find(repo)` returns the components (name -> folder) and the dependencies between them, or None when the repository declares no
workspace with at least two components. Test, example, documentation and benchmark packages are left out.
"""
import json
import re
import tomllib
from pathlib import Path
from typing import Any

import yaml

AUX = re.compile(r"(^|[-_.])(tests?|testing|e2e|examples?|samples?|docs?|benchmarks?|bench|fixtures?|demos?|lint|playground|"
                 r"storybook|website)$", re.I)
MAX_MEMBERS = 300
MAX_WALK = 50_000
# Folders that hold dependencies, build output or tool state, never the product's own code. Not descended into at all.
PRUNE = {"node_modules", ".git", ".hg", ".svn", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
         "dist", "build", "out", "target", "obj", "bin", ".gradle", ".idea", ".vscode", "Pods", "Carthage", "DerivedData", ".build",
         "vendor", "coverage", ".pytest_cache", ".mypy_cache", ".tox", ".terraform", "bower_components", ".dart_tool"}


BUILD_OUTPUT = re.compile(r"^(dist|build|out)[-_.]")  # dist-electron/, build-release/, out_web/: generated, never source


def walk(root: Path, limit: int = MAX_WALK):
    """Every file under `root`, without ever entering dependency or build folders (a project's node_modules alone can hold
    hundreds of thousands of files). Stops after `limit` files."""
    import os
    seen = 0
    for here, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in PRUNE and not d.startswith(".") and not BUILD_OUTPUT.match(d))
        for f in sorted(files):
            yield Path(here) / f
            seen += 1
            if seen >= limit:
                return


def _aux(path: str) -> bool:
    return any(AUX.search(seg) for seg in re.split(r"[/:]", path) if seg)


def _globbed(repo: Path, patterns: list[str]) -> list[Path]:
    out: list[Path] = []
    for pat in patterns:
        pat = pat.strip().strip("/").removeprefix("./")
        if not pat or pat.startswith("!"):
            continue
        hits = repo.glob(pat) if any(c in pat for c in "*?[") else [repo / pat]
        out += [p for p in hits if p.is_dir() and "node_modules" not in p.parts]
    return sorted(set(out))[:MAX_MEMBERS]


def _names(paths: dict[str, str]) -> dict[str, str]:
    """A short, unique display name per component folder: its last segment, or more of its path when that is ambiguous."""
    last = {k: v.rstrip("/").split("/")[-1] for k, v in paths.items()}
    taken: dict[str, int] = {}
    for n in last.values():
        taken[n] = taken.get(n, 0) + 1
    return {k: (last[k] if taken[last[k]] == 1 else paths[k].replace("/", ".")) for k in paths}


def _result(tool: str, members: dict[str, str], deps: set[tuple[str, str]]) -> dict[str, Any] | None:
    """members: key -> folder; deps between keys. Keys become display names."""
    members = {k: p for k, p in members.items() if not _aux(p) and not _aux(k)}
    if len(members) < 2:
        return None
    names = _names(members)
    return {"tool": tool,
            "components": {names[k]: members[k] for k in members},
            "dependencies": {(names[a], names[b]) for a, b in deps if a in names and b in names and a != b}}


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(errors="ignore"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _js(repo: Path) -> dict[str, Any] | None:
    root = _read_json(repo / "package.json")
    patterns = root.get("workspaces") or []
    if isinstance(patterns, dict):
        patterns = patterns.get("packages") or []
    pnpm = repo / "pnpm-workspace.yaml"
    if pnpm.is_file():
        try:
            patterns = list(patterns) + list((yaml.safe_load(pnpm.read_text(errors="ignore")) or {}).get("packages") or [])
        except yaml.YAMLError:
            pass
    patterns = list(patterns) + list(_read_json(repo / "lerna.json").get("packages") or [])
    if not patterns:
        return None
    members: dict[str, str] = {}
    manifests: dict[str, dict] = {}
    for d in _globbed(repo, [str(p) for p in patterns]):
        pkg = _read_json(d / "package.json")
        if pkg:
            key = str(pkg.get("name") or d.name)
            members[key] = d.relative_to(repo).as_posix()
            manifests[key] = pkg
    deps = {(key, other) for key, pkg in manifests.items()
            for section in ("dependencies", "peerDependencies", "devDependencies")
            for other in (pkg.get(section) or {}) if other in members and other != key}
    found = _result("npm workspaces", members, deps)
    if found:  # imports by package name (`@excalidraw/element`) resolve to that component
        short = _names({k: v for k, v in members.items() if not _aux(v) and not _aux(k)})
        found["packages"] = {k: short[k] for k in short}
    return found


def _kebab(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", s).lower()


def _norm(path: str) -> str:
    return re.sub(r"[-_]", "", path.lower())


GRADLE_DEP = re.compile(r"^\s*(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp)\s*\(?\s*(?:projects\.([\w.]+)|project\(\s*(?:path\s*=\s*)?['\"]([:\w-]+)['\"])",
                        re.M)


def _gradle(repo: Path) -> dict[str, Any] | None:
    settings = next((repo / n for n in ("settings.gradle.kts", "settings.gradle") if (repo / n).is_file()), None)
    if settings is None:
        return None
    text = settings.read_text(errors="ignore")
    paths: list[str] = []
    for call in re.findall(r"\binclude\b\s*\(?([^)\n]*)\)?", text):
        paths += re.findall(r"['\"](:?[\w:.-]+)['\"]", call)
    members = {p if p.startswith(":") else ":" + p: (p.lstrip(":").replace(":", "/")) for p in paths}
    members = {k: v for k, v in members.items() if (repo / v).is_dir()}
    by_norm = {_norm(k): k for k in members}
    deps: set[tuple[str, str]] = set()
    for key, folder in members.items():
        build = next((repo / folder / n for n in ("build.gradle.kts", "build.gradle") if (repo / folder / n).is_file()), None)
        if build is None:
            continue
        for accessor, literal in GRADLE_DEP.findall(build.read_text(errors="ignore")):
            target = literal or ":" + ":".join(_kebab(s) for s in accessor.split("."))
            hit = members.get(target) and target or by_norm.get(_norm(target))
            if hit:
                deps.add((key, hit))
    keyed = {k.lstrip(":").replace(":", "."): v for k, v in members.items()}
    return _result("Gradle", keyed, {(a.lstrip(":").replace(":", "."), b.lstrip(":").replace(":", ".")) for a, b in deps})


def _call_blocks(text: str, opener: str) -> list[str]:
    """The text inside each `opener(` ... matching `)` (Package.swift target declarations)."""
    out = []
    for m in re.finditer(re.escape(opener) + r"\s*\(", text):
        depth, i = 1, m.end()
        while i < len(text) and depth:
            depth += {"(": 1, ")": -1}.get(text[i], 0)
            i += 1
        out.append(text[m.end():i - 1])
    return out


def _swift(repo: Path) -> dict[str, Any] | None:
    manifest = repo / "Package.swift"
    if not manifest.is_file():
        return None
    text = manifest.read_text(errors="ignore")
    members: dict[str, str] = {}
    wanted: dict[str, list[str]] = {}
    for opener in (".target", ".executableTarget", ".macro", ".plugin"):
        for block in _call_blocks(text, opener):
            name = re.search(r'name:\s*"([^"]+)"', block)
            if not name:
                continue
            path = re.search(r'path:\s*"([^"]+)"', block)
            folder = path.group(1) if path else next((f"{d}/{name.group(1)}" for d in ("Sources", "Source", "Plugins")
                                                      if (repo / d / name.group(1)).is_dir()), f"Sources/{name.group(1)}")
            members[name.group(1)] = folder
            deps_text = re.search(r"dependencies:\s*\[(.*?)\]", block, re.S)
            wanted[name.group(1)] = re.findall(r'"([^"]+)"', deps_text.group(1) if deps_text else "")
    deps = {(a, b) for a, targets in wanted.items() for b in targets if b in members}
    return _result("Swift Package Manager", members, deps)


def _toml(path: Path) -> dict:
    try:
        return tomllib.loads(path.read_text(errors="ignore"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def _cargo(repo: Path) -> dict[str, Any] | None:
    root = _toml(repo / "Cargo.toml")
    patterns = (root.get("workspace") or {}).get("members") or []
    if not patterns:
        return None
    members: dict[str, str] = {}
    manifests: dict[str, dict] = {}
    for d in _globbed(repo, patterns):
        data = _toml(d / "Cargo.toml")
        name = (data.get("package") or {}).get("name")
        if name:
            members[name] = d.relative_to(repo).as_posix()
            manifests[name] = data
    if (root.get("package") or {}).get("name"):  # the root crate is a member too
        members[root["package"]["name"]] = "."
        manifests[root["package"]["name"]] = root
    deps = {(name, other) for name, data in manifests.items()
            for section in ("dependencies", "build-dependencies") for other in (data.get(section) or {}) if other in members}
    return _result("Cargo workspace", {k: ("" if v == "." else v) for k, v in members.items()}, deps)


def _maven(repo: Path) -> dict[str, Any] | None:
    pom = repo / "pom.xml"
    if not pom.is_file():
        return None
    modules = re.findall(r"<module>\s*([^<\s]+)\s*</module>", pom.read_text(errors="ignore"))
    if not modules:
        return None
    members: dict[str, str] = {}
    texts: dict[str, str] = {}
    for m in modules:
        child = repo / m / "pom.xml"
        if child.is_file():
            text = child.read_text(errors="ignore")
            body = re.sub(r"<parent>.*?</parent>", "", text, flags=re.S)
            art = re.search(r"<artifactId>\s*([^<\s]+)\s*</artifactId>", body)
            if art:
                members[art.group(1)] = m.strip("/")
                texts[art.group(1)] = body
    deps = {(a, b) for a, text in texts.items()
            for b in re.findall(r"<dependency>.*?<artifactId>\s*([^<\s]+)\s*</artifactId>", text, re.S) if b in members}
    return _result("Maven modules", members, deps)


def _dotnet(repo: Path) -> dict[str, Any] | None:
    files = list(walk(repo, MAX_WALK))
    if not any(p.suffix in (".sln", ".slnx") and len(p.relative_to(repo).parts) <= 2 for p in files):
        return None  # project files without a solution are parts of something else (a polyglot repo), not a .NET product
    projects = [p for p in files if p.suffix in (".csproj", ".fsproj", ".vbproj")][:MAX_MEMBERS]
    if len(projects) < 2:
        return None
    members = {p.stem: p.parent.relative_to(repo).as_posix() for p in projects}
    deps: set[tuple[str, str]] = set()
    for p in projects:
        for ref in re.findall(r'<ProjectReference\s+Include="([^"]+)"', p.read_text(errors="ignore")):
            target = Path(ref.replace("\\", "/")).stem
            if target in members:
                deps.add((p.stem, target))
    return _result(".NET projects", members, deps)


def _go_work(repo: Path) -> dict[str, Any] | None:
    work = repo / "go.work"
    if not work.is_file():
        return None
    text = work.read_text(errors="ignore")
    uses = re.findall(r"^\s*use\s+(\S+)", text, re.M) + [u for block in re.findall(r"use\s*\((.*?)\)", text, re.S)
                                                          for u in block.split()]
    members: dict[str, str] = {}
    module_paths: dict[str, str] = {}
    for u in uses:
        mod = repo / u.strip() / "go.mod"
        if mod.is_file():
            path = re.search(r"^module\s+(\S+)", mod.read_text(errors="ignore"), re.M)
            rel = (repo / u.strip()).resolve().relative_to(repo.resolve()).as_posix()
            members[rel] = "" if rel == "." else rel
            if path:
                module_paths[path.group(1)] = rel
    deps = {(rel, module_paths[req]) for rel in members
            for req in re.findall(r"^\s*(?:require\s+)?(\S+)\s+v[\d.]+", (repo / (members[rel] or ".") / "go.mod").read_text(errors="ignore"), re.M)
            if req in module_paths}
    return _result("Go workspace", members, deps)


DETECTORS = (_js, _gradle, _swift, _cargo, _maven, _go_work, _dotnet)


def find(repo: Path) -> dict[str, Any] | None:
    """The first workspace the repository declares with two or more product components, or None."""
    for detect in DETECTORS:
        try:
            found = detect(repo)
        except (OSError, ValueError, RecursionError):
            found = None
        if found:
            return found
    return None
