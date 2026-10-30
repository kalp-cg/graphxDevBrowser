"""Pre-merge impact: which services a change touches and what depends on them."""
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sentinel import workspace
from sentinel.impact import changed_files, impact_from_manifest, service_for_file, to_markdown
from sentinel.ingest import codebase

SHOP = Path(__file__).resolve().parents[2] / "sandbox" / "shop"


def manifest(services, deps):
    return {"services": [{"name": n, "path": p, "kind": "service", "tier": t, "team": None} for n, p, t in services],
            "dependencies": deps}


def test_a_change_to_a_leaf_service_lights_up_everything_above_it():
    m = codebase.scan(SHOP)
    r = impact_from_manifest(m, ["services/inventory/app.py", "README.md"])
    assert [c["name"] for c in r["changed"]] == ["inventory"]
    assert {a["name"] for a in r["affected"]} == {"checkout", "gateway", "web"}
    assert r["unmapped_files"] == ["README.md"]
    assert r["risk"] == "high" and "critical" in r["risk_reason"]
    assert r["risk_is_a_heuristic"] is True


def test_a_change_to_an_entry_point_affects_nobody_else():
    r = impact_from_manifest(codebase.scan(SHOP), ["services/web/index.html"])
    assert [c["name"] for c in r["changed"]] == ["web"] and r["affected"] == []
    assert r["risk"] in ("low", "medium")


def test_nothing_in_a_service_means_no_risk():
    r = impact_from_manifest(codebase.scan(SHOP), ["docs/notes.md", ".github/workflows/ci.yml"])
    assert r["changed"] == [] and r["risk"] == "none"
    assert "No changed file" in to_markdown(r)


def test_the_longest_service_folder_wins_and_nested_services_do_not_leak():
    m = manifest([("api", "services/api", "medium"), ("api-admin", "services/api/admin", "medium")], [])
    assert service_for_file(m, "services/api/admin/x.py") == "api-admin"
    assert service_for_file(m, "services/api/x.py") == "api"
    assert service_for_file(m, "services/apis/x.py") is None  # `services/api` is not a prefix of `services/apis`


def test_two_changed_services_share_what_depends_on_them():
    m = manifest([("a", "a", "low"), ("b", "b", "low"), ("c", "c", "medium"), ("d", "d", "low")],
                 [["c", "a"], ["c", "b"], ["d", "c"]])
    r = impact_from_manifest(m, ["a/x", "b/y", "a/z"])
    assert [c["files"] for c in r["changed"]] == [["a/x", "a/z"], ["b/y"]]
    assert [(a["name"], a["hops"], a["via"]) for a in r["affected"]] == [("c", 1, ["a", "b"]), ("d", 2, ["a", "b"])]


def test_a_service_that_changed_is_not_also_listed_as_affected():
    m = manifest([("a", "a", "low"), ("b", "b", "low")], [["b", "a"]])
    r = impact_from_manifest(m, ["a/x", "b/y"])
    assert r["affected"] == [] and {c["name"] for c in r["changed"]} == {"a", "b"}


def test_a_monolith_maps_files_to_its_modules(tmp_path):
    def write(rel, text=""):
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    write("package.json", "{}")
    write("lib/db.ts", "export const db = 1")
    write("lib/ai/agent.ts", "import { db } from '../db'\nexport const a = db")
    write("app/api/orders/route.ts", "import { a } from '@/lib/ai/agent'\nexport const GET = a")
    write("app/api/health/route.ts", "export const GET = 1")
    write("components/Nav.tsx", "export default 1")
    m = codebase.scan(tmp_path)
    assert service_for_file(m, "lib/ai/agent.ts") == "lib.ai"
    r = impact_from_manifest(m, ["lib/ai/agent.ts"])
    assert [c["name"] for c in r["changed"]] == ["lib.ai"]
    assert "api.orders" in {a["name"] for a in r["affected"]} and "api.health" not in {a["name"] for a in r["affected"]}


def test_markdown_for_a_pull_request_names_what_changed_and_what_depends_on_it():
    md = to_markdown(impact_from_manifest(codebase.scan(SHOP), ["services/inventory/app.py"]))
    assert "### SentinelGraph impact: **high** risk" in md
    assert "| `inventory` |" in md and "`checkout`" in md and "heuristic" in md


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args], check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "svc" / "a").mkdir(parents=True)
    (tmp_path / "svc" / "a" / "go.mod").write_text("module a\n")
    (tmp_path / "svc" / "a" / "main.go").write_text("package main\n")
    _git(tmp_path, "init", "-q", "-b", "main")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def test_changed_files_sees_uncommitted_work_and_a_branch(repo):
    assert changed_files(repo) == []
    (repo / "svc" / "a" / "main.go").write_text("package main\n// edit\n")
    (repo / "svc" / "a" / "new.go").write_text("package main\n")  # untracked
    assert changed_files(repo) == ["svc/a/main.go", "svc/a/new.go"]
    _git(repo, "checkout", "-q", "-b", "feature")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "work")
    assert changed_files(repo) == []                      # nothing uncommitted any more
    assert changed_files(repo, "main") == ["svc/a/main.go", "svc/a/new.go"]  # but the branch differs from main
    with pytest.raises(ValueError):
        changed_files(repo, "no-such-ref")


def test_the_api_uses_the_connected_project(repo, tmp_path, monkeypatch):
    from sentinel.api.main import app

    monkeypatch.setattr(workspace, "_path", lambda graph: tmp_path / "ws.json")
    c = TestClient(app)  # no lifespan: this route never touches the graph
    assert c.post("/api/impact", json={}).status_code == 422  # nothing connected yet
    m = codebase.scan(repo)
    workspace.save({"repo": m["repo"], "repo_path": m["repo_path"], "aliases": {},
                    "manifest": {"services": [{k: s.get(k) for k in ("name", "path", "kind", "tier", "team")} for s in m["services"]],
                                 "dependencies": m["dependencies"]}})
    assert c.post("/api/impact", json={}).json()["changed"] == []
    (repo / "svc" / "a" / "main.go").write_text("package main\n// edit\n")
    r = c.post("/api/impact", json={}).json()
    assert [(x["name"], x["files"]) for x in r["changed"]] == [("a", ["svc/a/main.go"])]
    assert c.post("/api/impact", json={"files": ["nothing/here.txt"]}).json()["changed"] == []
    assert c.post("/api/impact", json={"base": "no-such-ref"}).status_code == 422


def test_the_command_line_prints_markdown_and_can_fail_a_build(repo):
    (repo / "svc" / "a" / "main.go").write_text("package main\n// edit\n")
    run = lambda *a: subprocess.run([sys.executable, "-m", "sentinel.ingest", "impact", str(repo), *a],  # noqa: E731
                                    capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1])
    ok = run()
    assert ok.returncode == 0 and "### SentinelGraph impact" in ok.stdout and "`a`" in ok.stdout
    assert '"risk"' in run("--format", "json").stdout
    assert run("--fail-on", "high").returncode == 0  # one standalone service: not high


def test_a_project_inside_a_bigger_git_repository_gets_paths_relative_to_itself(tmp_path):
    """The sample shop lives in a monorepo: git reports paths from the git root; services are relative to the project."""
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "a.md").write_text("x")
    project = tmp_path / "apps" / "shop"
    (project / "svc" / "a").mkdir(parents=True)
    (project / "svc" / "a" / "go.mod").write_text("module a\n")
    (project / "svc" / "a" / "main.go").write_text("package main\n")
    _git(tmp_path, "init", "-q", "-b", "main")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-q", "-m", "init")
    (project / "svc" / "a" / "main.go").write_text("package main\n// edit\n")
    (tmp_path / "docs" / "a.md").write_text("changed outside the project")
    assert changed_files(project) == ["svc/a/main.go"]  # not apps/shop/svc/a/main.go, and not docs/a.md
    assert [c["name"] for c in impact_from_manifest(codebase.scan(project), changed_files(project))["changed"]] == ["a"]
