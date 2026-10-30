"""Pre-merge impact: which services does this change touch, and what depends on them?

The map says how services depend on each other; git says which files a change touches. Together they answer the
question before anything is deployed: *if I merge this, what could break?*

Pure functions over a scan manifest (ingest/codebase.py) and a list of changed files, so it works from the API (the
connected project), from the command line, and in CI with no graph server at all.
"""
import subprocess
from collections import deque
from pathlib import Path
from typing import Any

from .ingest.modules import module_of

TIER_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def changed_files(repo: Path, base: str | None = None) -> list[str]:
    """Files changed in the working tree (staged, unstaged, untracked), or since `base` (`origin/main`) for a branch.
    Paths are relative to `repo`, which may be a folder inside a larger git repository."""
    def git(*args: str) -> list[str]:
        try:
            out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout
        except FileNotFoundError as exc:
            raise ValueError("git is not installed") from exc
        except subprocess.CalledProcessError as exc:
            raise ValueError((exc.stderr or "git failed").strip().splitlines()[-1]) from exc
        return [line for line in out.splitlines() if line.strip()]

    if base:
        found = git("diff", "--name-only", "--relative", f"{base}...HEAD")
    else:
        found = git("diff", "--name-only", "--relative", "HEAD") + git("ls-files", "--others", "--exclude-standard")
    return sorted(set(found))


def service_for_file(manifest: dict[str, Any], rel: str) -> str | None:
    """The service (or module of a monolith) a file belongs to: the longest matching service folder."""
    services = manifest["services"]
    names = {s["name"] for s in services}
    if any(s.get("kind") == "module" for s in services):
        m = module_of(rel)
        return m if m in names else None
    best, best_len = None, -1
    for s in services:
        p = (s.get("path") or "").strip("/")
        if p and (rel == p or rel.startswith(p + "/")) and len(p) > best_len:
            best, best_len = s["name"], len(p)
    return best


def _callers(manifest: dict[str, Any]) -> dict[str, set[str]]:
    callers: dict[str, set[str]] = {}
    names = {s["name"] for s in manifest["services"]}
    for a, b in manifest["dependencies"]:
        if a in names and b in names:
            callers.setdefault(b, set()).add(a)
    return callers


def impact_from_manifest(manifest: dict[str, Any], files: list[str]) -> dict[str, Any]:
    """What a set of changed files affects, from the scanned map. Risk is a heuristic, stated as one."""
    by_name = {s["name"]: s for s in manifest["services"]}
    callers = _callers(manifest)
    touched: dict[str, list[str]] = {}
    unmapped: list[str] = []
    for f in files:
        svc = service_for_file(manifest, f)
        if svc:
            touched.setdefault(svc, []).append(f)
        else:
            unmapped.append(f)

    changed = []
    affected: dict[str, dict[str, Any]] = {}
    for name in sorted(touched, key=lambda n: (TIER_RANK.get(by_name[n].get("tier", "medium"), 9), n)):
        # Everything that depends on this service, directly or not: breadth-first up the dependency edges.
        seen: dict[str, int] = {}
        queue = deque([(name, 0)])
        while queue:
            cur, d = queue.popleft()
            for up in sorted(callers.get(cur, ())):
                if up not in seen and up != name:
                    seen[up] = d + 1
                    queue.append((up, d + 1))
        for up, d in seen.items():
            if up not in touched:
                affected.setdefault(up, {"name": up, "tier": by_name[up].get("tier", "medium"), "hops": d, "via": []})
                affected[up]["hops"] = min(affected[up]["hops"], d)
                affected[up]["via"].append(name)
        changed.append({"name": name, "tier": by_name[name].get("tier", "medium"), "kind": by_name[name].get("kind", "service"),
                        "team": by_name[name].get("team"), "files": touched[name], "dependents": len(seen),
                        "dependent_names": sorted(seen)})

    ranked = sorted(affected.values(), key=lambda a: (TIER_RANK.get(a["tier"], 9), a["hops"], a["name"]))
    total = len(by_name)
    reach = len(touched) + len(affected)
    critical = [x["name"] for x in [*changed, *ranked] if x["tier"] == "critical"]
    if not touched:
        risk, why = "none", "no changed file belongs to a service"
    elif (critical and affected) or (total >= 3 and affected and reach / total >= 0.4):
        risk, why = "high", ("a critical service is in the blast radius" if critical else
                             f"{reach} of {total} services are in the blast radius")
    elif len(affected) >= 3 or any(c["dependents"] >= 3 for c in changed):
        risk, why = "medium", f"{len(affected)} other services depend on what changed"
    else:
        risk, why = "low", "few or no other services depend on what changed"
    return {"files": len(files), "changed": changed, "affected": ranked, "unmapped_files": unmapped, "services_total": total,
            "risk": risk, "risk_reason": why, "risk_is_a_heuristic": True}


def to_markdown(result: dict[str, Any]) -> str:
    """The result as a comment for a pull request."""
    r = result
    if not r["changed"]:
        return (f"### SentinelGraph impact\n\nNo changed file belongs to a mapped service ({r['files']} file(s) checked). "
                "Nothing else is affected.\n")
    lines = [f"### SentinelGraph impact: **{r['risk']}** risk",
             f"{len(r['changed'])} service(s) changed; {len(r['affected'])} more depend on them (of {r['services_total']} mapped). "
             f"_{r['risk_reason'].capitalize()}. The level is a heuristic._", "",
             "| Changed | Tier | Files | Depended on by |", "| :--- | :--- | ---: | :--- |"]
    for c in r["changed"]:
        deps = ", ".join(f"`{d}`" for d in c["dependent_names"][:6]) + (" …" if len(c["dependent_names"]) > 6 else "")
        lines.append(f"| `{c['name']}` | {c['tier']} | {len(c['files'])} | {deps or 'nothing'} |")
    if r["affected"]:
        lines += ["", "**Could be affected:** " + ", ".join(f"`{a['name']}` ({a['tier']})" for a in r["affected"][:12])
                  + (" …" if len(r["affected"]) > 12 else "")]
    if r["unmapped_files"]:
        lines.append(f"\n{len(r['unmapped_files'])} changed file(s) belong to no mapped service (docs, config, tooling).")
    return "\n".join(lines) + "\n"
