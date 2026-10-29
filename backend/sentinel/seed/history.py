"""Change history: Deployment -> Commit -> Person, all older than 24 h in the baseline."""
import hashlib
import random

from ..db import Batch, Graph, link, upsert
from .catalog import PEOPLE, SERVICES

DAY_MS = 24 * 60 * 60 * 1000
HOUR_MS = 60 * 60 * 1000

COMMIT_MESSAGES = [
    "Bump dependencies",
    "Add request tracing to handlers",
    "Refactor retry policy",
    "Tune connection timeouts",
    "Fix null check in serializer",
    "Add metrics for cache hit ratio",
    "Improve error messages",
    "Upgrade base image",
    "Remove dead feature flag",
    "Batch writes to reduce round trips",
]


def sha_for(*parts: str) -> str:
    return hashlib.sha1(":".join(parts).encode()).hexdigest()[:10]


def members_by_team() -> dict[str, list[str]]:
    teams: dict[str, list[str]] = {}
    for handle, _name, _role, team in PEOPLE:
        teams.setdefault(team, []).append(handle)
    return teams


def deployment_rows(rng: random.Random, now: int) -> list[dict]:
    """2-3 historical deployments per service, each with one commit by a member of the owning team."""
    members = members_by_team()
    rows = []
    for name, team, *_ in SERVICES:
        count = rng.randint(2, 3)
        ages_days = sorted(rng.sample(range(2, 30), count), reverse=True)
        for i, age in enumerate(ages_days):
            version = f"v{i + 1}.{rng.randint(0, 9)}.0"
            msg = rng.choice(COMMIT_MESSAGES)
            rows.append({
                "svc": name,
                "version": version,
                "at": now - age * DAY_MS - rng.randint(0, 23) * HOUR_MS,
                "summary": msg,
                "sha": sha_for(name, version),
                "message": msg,
                "files": rng.randint(1, 12),
                "author": rng.choice(members[team]),
            })
    return rows


def create_deployments(graph: Graph | Batch, rows: list[dict], status: str = "live", origin: str = "") -> None:
    upsert(graph, "Deployment", [
        {"uid": f"dep:{r['svc']}:{r['version']}", "id": f"{r['svc']}@{r['version']}", "version": r["version"],
         "at": r["at"], "status": status, "change_summary": r["summary"], "origin": origin} for r in rows
    ])
    upsert(graph, "Commit", [{"uid": f"commit:{r['sha']}", "sha": r["sha"], "message": r["message"],
                              "files_changed": r["files"]} for r in rows])
    link(graph, "Deployment", "DEPLOYED_TO", "Service", [(f"dep:{r['svc']}:{r['version']}", f"svc:{r['svc']}")
                                                         for r in rows])
    link(graph, "Deployment", "CONTAINS", "Commit", [(f"dep:{r['svc']}:{r['version']}", f"commit:{r['sha']}")
                                                     for r in rows])
    link(graph, "Commit", "AUTHORED_BY", "Person", [(f"commit:{r['sha']}", f"person:{r['author']}") for r in rows])


def build_history(graph: Graph | Batch, rng: random.Random, now: int) -> None:
    create_deployments(graph, deployment_rows(rng, now))
