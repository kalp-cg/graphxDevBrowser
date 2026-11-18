"""Repository shapes beyond Docker Compose: declared workspaces, single apps next to helper folders, and the languages whose
structure lives in manifests. Each case is the minimal version of a real repository the codebase sandbox (sandbox/codebases.py)
checks online."""
import json
from pathlib import Path

import pytest

from sentinel.ingest import codebase, workspaces


def _write(root: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    return root


def _edges(m: dict) -> set[tuple[str, str]]:
    return {tuple(d) for d in m["dependencies"]}


def test_npm_workspaces_are_components_linked_by_package_name(tmp_path):
    repo = _write(tmp_path / "mono", {
        "package.json": json.dumps({"private": True, "workspaces": ["packages/*", "examples/*"]}),
        "packages/core/package.json": json.dumps({"name": "@acme/core"}),
        "packages/core/src/index.ts": "export const x = 1",
        "packages/ui/package.json": json.dumps({"name": "@acme/ui", "dependencies": {"@acme/core": "*", "react": "18"}}),
        "packages/ui/src/Button.tsx": "import { x } from '@acme/core'",
        "examples/demo/package.json": json.dumps({"name": "demo", "dependencies": {"@acme/ui": "*"}}),
    })
    m = codebase.scan(repo)
    assert {s["name"] for s in m["services"]} == {"core", "ui"}        # the example is not part of the product
    assert ("ui", "core") in _edges(m)
    assert "npm workspaces" in m["source"]


def test_gradle_modules_and_their_project_dependencies_but_not_test_ones(tmp_path):
    repo = _write(tmp_path / "android", {
        "settings.gradle.kts": 'includeBuild("build-logic")\ninclude(":app")\ninclude(":core:data")\ninclude(":core:testing")\n'
                               'include(":feature:search")\n',
        "app/build.gradle.kts": "dependencies {\n    implementation(projects.feature.search)\n    implementation(project(\":core:data\"))\n}",
        "core/data/build.gradle.kts": "",
        "core/testing/build.gradle.kts": "",
        "feature/search/build.gradle.kts": "dependencies {\n    implementation(projects.core.data)\n"
                                           "    testImplementation(projects.core.testing)\n}",
        "app/src/main/kotlin/App.kt": "class App",
    })
    found = workspaces.find(repo)
    assert found and found["components"] == {"app": "app", "data": "core/data", "search": "feature/search"}  # short names
    assert found["dependencies"] == {("app", "search"), ("app", "data"), ("search", "data")}


def test_swift_package_targets(tmp_path):
    repo = _write(tmp_path / "pkg", {
        "Package.swift": '''let package = Package(name: "Kit", targets: [
            .target(name: "Core", dependencies: []),
            .target(name: "Net", dependencies: ["Core", .product(name: "NIO", package: "swift-nio")]),
            .executableTarget(name: "cli", dependencies: ["Net"]),
            .testTarget(name: "CoreTests", dependencies: ["Core"]),
        ])''',
        "Sources/Core/Core.swift": "struct Core {}", "Sources/Net/Net.swift": "struct Net {}", "Sources/cli/main.swift": "",
    })
    found = workspaces.find(repo)
    assert found and set(found["components"]) == {"Core", "Net", "cli"}
    assert found["dependencies"] == {("Net", "Core"), ("cli", "Net")}


def test_cargo_workspace_crates(tmp_path):
    repo = _write(tmp_path / "rs", {
        "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
        "crates/core/Cargo.toml": '[package]\nname = "engine-core"\n',
        "crates/cli/Cargo.toml": '[package]\nname = "engine-cli"\n[dependencies]\nengine-core = { path = "../core" }\nserde = "1"\n',
    })
    found = workspaces.find(repo)
    assert found and found["dependencies"] == {("cli", "core")}


def test_maven_modules_and_dotnet_projects(tmp_path):
    mvn = _write(tmp_path / "mvn", {
        "pom.xml": "<project><modules><module>api</module><module>domain</module></modules></project>",
        "api/pom.xml": "<project><parent><artifactId>root</artifactId></parent><artifactId>api</artifactId>"
                       "<dependencies><dependency><artifactId>domain</artifactId></dependency></dependencies></project>",
        "domain/pom.xml": "<project><artifactId>domain</artifactId></project>",
    })
    assert workspaces.find(mvn)["dependencies"] == {("api", "domain")}
    net = _write(tmp_path / "net", {
        "Shop.sln": "", "src/Web/Web.csproj": '<Project><ItemGroup><ProjectReference Include="..\\Core\\Core.csproj" /></ItemGroup></Project>',
        "src/Core/Core.csproj": "<Project />",
    })
    assert workspaces.find(net)["dependencies"] == {("Web", "Core")}


def test_dotnet_projects_without_a_solution_are_not_a_workspace(tmp_path):
    repo = _write(tmp_path / "poly", {"a/A.csproj": "<Project />", "b/B.csproj": "<Project />"})
    assert workspaces.find(repo) is None


def test_an_app_at_the_root_is_not_replaced_by_a_helper_folder_next_to_it(tmp_path):
    """PocketBase: Go code at the root and an admin UI in ui/; Express: an e2e/ folder with its own package.json."""
    repo = _write(tmp_path / "server", {
        "go.mod": "module example.com/server\n",
        "ui/package.json": "{}",
        **{f"{pkg}/{pkg}.go": f"package {pkg}\ntype {pkg.title()}Thing struct{{}}\n" for pkg in ("apis", "core", "forms")},
        "apis/serve.go": "package apis\nvar _ = CoreThing{}\n",
        "e2e/package.json": "{}",
    })
    m = codebase.scan(repo)
    names = {s["name"] for s in m["services"]}
    assert {"apis", "core", "forms"} <= names and "e2e" not in names
    assert ("apis", "core") in _edges(m)


def test_compose_that_only_runs_databases_maps_the_app_in_the_repository(tmp_path):
    """Spring PetClinic: compose starts MySQL and Postgres; the Java app runs from the repository."""
    base = "src/main/java/org/acme/clinic"
    repo = _write(tmp_path / "clinic", {
        "docker-compose.yml": "services:\n  mysql: {image: 'mysql:9'}\n",
        "pom.xml": "<project/>",
        f"{base}/owner/Owner.java": "package x; import jakarta.persistence.Entity; class OwnerEntity extends PetThing {}",
        f"{base}/owner/OwnerController.java": "class OwnerController { OwnerEntity o; }",
        f"{base}/pet/Pet.java": "class PetThing {}",
        f"{base}/vet/Vet.java": "class VetThing {}",
        f"{base}/ClinicApp.java": "class ClinicApp {}",
    })
    m = codebase.scan(repo)
    assert {"owner", "pet", "vet"} <= {s["name"] for s in m["services"]}  # the Java packages, not `main.java`
    assert ("owner", "pet") in _edges(m)
    assert ("owner", "mysql") in _edges(m)                                  # JPA code uses the database compose runs


def test_a_flat_python_package_is_split_by_file_and_relative_imports_count(tmp_path):
    files = {"pyproject.toml": "", "src/lib/__init__.py": "from .api import get\n"}
    files |= {f"src/lib/{n}.py": "" for n in ("models", "utils", "auth", "hooks")}
    files["src/lib/api.py"] = "from . import sessions\nfrom .models import Request\n"
    files["src/lib/sessions.py"] = "from lib.utils import x\nfrom .auth import y\n"
    m = codebase.scan(_write(tmp_path / "lib", files))
    assert {("lib.api", "lib.sessions"), ("lib.api", "lib.models"), ("lib.sessions", "lib.utils"),
            ("lib.sessions", "lib.auth")} <= _edges(m)


def test_svelte_components_import_through_lib(tmp_path):
    repo = _write(tmp_path / "kit", {
        "package.json": "{}", "svelte.config.js": "export default {}",
        "src/routes/+page.svelte": "<script>\n  import * as api from '$lib/api.js';\n  import Card from './Card.svelte';\n</script>",
        "src/routes/Card.svelte": "<script>import { fmt } from '$lib/format.js';</script>",
        "src/lib/api.js": "export const get = 1", "src/lib/format.js": "export const fmt = 1",
    })
    m = codebase.scan(repo)
    assert ("routes", "lib") in _edges(m)


def test_dependency_folders_are_never_walked(tmp_path, monkeypatch):
    repo = _write(tmp_path / "web", {"package.json": "{}", "src/a/a.ts": "import '../b/b'", "src/b/b.ts": ""})
    deep = repo / "node_modules" / "huge"
    deep.mkdir(parents=True)
    (deep / "index.js").write_text("")
    seen = [p for p in workspaces.walk(repo)]
    assert all("node_modules" not in p.parts for p in seen)


@pytest.mark.parametrize("marker, expected", [("Package.swift", "swift"), ("build.gradle.kts", "kotlin")])
def test_language_follows_the_code_not_the_build_tool(tmp_path, marker, expected):
    ext = {"swift": "swift", "kotlin": "kt"}[expected]
    repo = _write(tmp_path / "p", {marker: "", "CMakeLists.txt": "", **{f"src/m{i}/F{i}.{ext}": f"class Foo{i}Bar {{}}" for i in range(3)}})
    assert codebase._language(repo) == expected


def test_check_my_changes_finds_the_file_module_of_a_flat_package(tmp_path):
    from sentinel.impact import service_for_file
    files = {"pyproject.toml": "", "src/lib/__init__.py": ""}
    files |= {f"src/lib/{n}.py": "" for n in ("models", "utils", "auth", "hooks", "sessions")}
    files["src/lib/api.py"] = "from .sessions import S\n"
    manifest = codebase.scan(_write(tmp_path / "lib", files))
    assert service_for_file(manifest, "src/lib/sessions.py") == "lib.sessions"


def test_the_only_app_in_a_compose_file_is_mapped_from_its_folder(tmp_path):
    repo = _write(tmp_path / "product", {
        "docker-compose.yml": "services:\n  api: {build: ./server}\n  db: {image: 'postgres:16'}\n",
        "server/requirements.txt": "",
        "server/app/routes/orders.py": "from app.store import save\n",
        "server/app/store/__init__.py": "import psycopg2\ndef save(): pass\n",
        "server/app/auth/tokens.py": "",
        "desktop/dist-electron/main.js": "", "desktop/package.json": "{}",
    })
    m = codebase.scan(repo)
    names = {s["name"] for s in m["services"]}
    assert {"app.routes", "app.store", "app.auth"} <= names and not any("dist" in n for n in names)
    assert ("app.routes", "app.store") in _edges(m) and ("app.store", "db") in _edges(m)
    assert next(s for s in m["services"] if s["name"] == "app.store")["path"] == "server/app/store"
