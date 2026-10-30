"""The sandbox: a 38-service company to run SentinelGraph on, and an exam for whoever investigates in it.

`load_company` rebuilds the seeded company (38 services in four layers, 8 teams, 18 engineers on call rotations, weeks of
deployments and commits, past incidents the agent can recall). Databases are also services of kind `database`, as they are in a
scanned repository, so they can fail like anything else.

`build_cases` is the exam: a healthy control (the right answer is "nothing is wrong"), the four named incidents, and failures
placed on purpose where they are hard: a database, a busy platform service, a service others depend on after a deploy, an edge
service, a degraded one, and two and three failures at once. We know what we broke, so `evaluate` can say, for any agent (the built-in one or a
language model), whether it found it. It scores outcomes, not style.
"""
import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .agent.loop import investigate
from .db import Batch, Graph, link, upsert
from .seed import catalog
from .seed.generator import counts, seed_baseline
from .seed.scenarios import SCENARIOS, inject_chaos, inject_scenario, soft_reset

CASE_TIMEOUT_S = 240
TIER_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def load_company(graph: Graph) -> dict[str, Any]:
    """Replace whatever is in the graph with the sandbox company, and say what is in it."""
    seed_baseline(graph)
    tiers = {s[0]: s[2] for s in catalog.SERVICES}
    callers: dict[str, list[str]] = {}
    for svc, db, _mode in catalog.DATA_ACCESS:
        callers.setdefault(db, []).append(svc)
    batch = Batch()
    upsert(batch, "Service", [
        {"uid": f"svc:{name}", "name": name, "kind": "database", "layer": "data", "language": engine, "status": "healthy",
         "root_fault": False, "revenue_per_min": 0,
         "tier": min((tiers.get(c, "medium") for c in callers.get(name, [])), key=lambda t: TIER_RANK.get(t, 9), default="medium")}
        for name, engine, _gb, _team in catalog.DATABASES])
    link(batch, "Service", "DEPENDS_ON", "Service", [
        (f"svc:{svc}", f"svc:{db}", {"uid": f"e:{svc}->{db}", "protocol": "sql", "weight": 1}) for svc, db in
        sorted({(s, d) for s, d, _m in catalog.DATA_ACCESS})])
    batch.send(graph)
    return describe(graph)


def describe(graph: Graph) -> dict[str, Any]:
    """What is in the graph, counted from the graph itself."""
    n = lambda vtype: len(graph.getVertices(vtype, select="name"))  # noqa: E731
    services = [v["attributes"] for v in graph.getVertices("Service", select="name,kind,layer,tier")]
    real = [s for s in services if s.get("kind") != "database"]
    layers: dict[str, int] = {}
    for s in real:
        layers[s.get("layer", "")] = layers.get(s.get("layer", ""), 0) + 1
    edges = sum(len(graph.getEdges("Service", f"svc:{s['name']}", "DEPENDS_ON")) for s in services)
    return {"services": len(real), "databases": len(services) - len(real), "teams": n("Team"), "engineers": n("Person"),
            "deployments": n("Deployment"), "commits": n("Commit"), "past_incidents": n("Incident"), "dependencies": edges,
            "layers": layers}


@dataclass
class Case:
    id: str
    title: str
    difficulty: str            # easy | medium | hard
    expected: list[str]        # what we broke; [] for the healthy control
    ops: list[tuple] = field(default_factory=list)   # ("scenario", name) | ("chaos", service, mode, deploy)


def _topology(graph: Graph) -> tuple[dict[str, dict], dict[str, set[str]], dict[str, set[str]]]:
    svcs = {v["attributes"]["name"]: v["attributes"] for v in graph.getVertices("Service", select="name,kind,layer,tier")}
    down: dict[str, set[str]] = {n: set() for n in svcs}
    up: dict[str, set[str]] = {n: set() for n in svcs}
    for n in svcs:
        for e in graph.getEdges("Service", f"svc:{n}", "DEPENDS_ON"):
            t = e["to_id"].removeprefix("svc:")
            if t in svcs:
                down[n].add(t)
                up[t].add(n)
    return svcs, down, up


def _reach(start: str, edges: dict[str, set[str]]) -> set[str]:
    seen, stack = set(), [start]
    while stack:
        for nxt in edges.get(stack.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def build_cases(graph: Graph, n: int = 12, seed: int = 7) -> list[Case]:
    """The exam, in an order that mixes difficulty so a short run is still a fair sample."""
    rng = random.Random(seed)
    svcs, down, up = _topology(graph)
    real = sorted(n_ for n_, a in svcs.items() if a.get("kind") != "database")
    dbs = sorted(n_ for n_, a in svcs.items() if a.get("kind") == "database" and up[n_])
    named = {s for spec in SCENARIOS.values() for s in [spec["root"][0]]}
    busy = sorted((s for s in real if svcs[s].get("layer") in ("platform", "data") and len(_reach(s, up)) >= 3 and s not in named),
                  key=lambda s: (-len(_reach(s, up)), s))
    mid = sorted(s for s in real if svcs[s].get("layer") == "business" and len(up[s]) >= 2 and s not in named)
    edge = sorted(s for s in real if not up[s] and s not in named)
    leafy = sorted(s for s in real if svcs[s].get("layer") == "business" and s not in named)

    def independent(pool: list[str], taken: list[str]) -> str | None:
        """A service that neither depends on nor is depended on by the ones already chosen."""
        ok = [s for s in pool if s not in taken and all(s not in _reach(t, down) | _reach(t, up) for t in taken)]
        return rng.choice(ok) if ok else None

    cases: list[Case] = [Case("control", "Nothing is wrong", "easy", [])]
    cases.append(Case("db-pool", "Named incident: database pool exhausted", "medium", [SCENARIOS["db-pool-exhaustion"]["root"][0]],
                      [("scenario", "db-pool-exhaustion")]))
    if busy:
        s = busy[0]
        cases.append(Case("platform", f"A busy platform service goes down ({s})", "medium", [s], [("chaos", s, "down", False)]))
    if dbs:
        s = rng.choice(dbs)
        cases.append(Case("database", f"A database goes down ({s})", "hard", [s], [("chaos", s, "down", False)]))
    if mid:
        s = rng.choice(mid)
        cases.append(Case("deploy", f"A service others depend on fails after a deploy ({s})", "medium", [s], [("chaos", s, "down", True)]))
    pair = [s for s in (independent(leafy, []),) if s]
    if pair and (b := independent(leafy, pair)):
        pair.append(b)
        cases.append(Case("two-failures", f"Two separate failures at once ({pair[0]} and {pair[1]})", "hard", pair,
                          [("chaos", pair[0], "down", False), ("chaos", pair[1], "down", False)]))
    if edge:
        s = rng.choice(edge)
        cases.append(Case("edge", f"A front-door service goes down ({s})", "easy", [s], [("chaos", s, "down", False)]))
    cases.append(Case("config-push", "Named incident: a bad config push", "medium", [SCENARIOS["bad-config-push"]["root"][0]],
                      [("scenario", "bad-config-push")]))
    if mid:
        s = mid[-1]
        cases.append(Case("degraded", f"A service is slow, not down ({s})", "medium", [s], [("chaos", s, "degraded", False)]))
    cases.append(Case("cache", "Named incident: cache stampede", "medium", [SCENARIOS["cache-stampede"]["root"][0]],
                      [("scenario", "cache-stampede")]))
    cases.append(Case("kafka", "Named incident: message bus rebalancing", "hard", [SCENARIOS["kafka-rebalance-storm"]["root"][0]],
                      [("scenario", "kafka-rebalance-storm")]))
    if len(pair) == 2 and (c := independent(leafy, pair)):
        trio = [*pair, c]
        cases.append(Case("three-failures", f"Three separate failures at once ({', '.join(trio)})", "hard", trio,
                          [("chaos", t, "down", False) for t in trio]))
    return cases[:max(1, n)]


def apply_case(graph: Graph, case: Case) -> None:
    """Healthy again, then break exactly what the case says."""
    soft_reset(graph)
    first = True
    for op in case.ops:
        if op[0] == "scenario":
            inject_scenario(op[1], graph)
        else:
            inject_chaos(op[1], op[2], op[3], graph, additive=not first)
            first = False


def judge(case: Case, final: dict[str, Any]) -> tuple[str, str]:
    """(outcome, one line of why). Correct means: named every failure we caused and nothing else."""
    found = set(final.get("root_causes") or ([final["root_cause"]] if final.get("root_cause") else []))
    expected = set(case.expected)
    if not expected:
        if not found and not final.get("actions"):
            return "correct", "left a healthy system alone"
        return "false-alarm", f"invented a problem: {', '.join(sorted(found)) or 'proposed actions'}"
    if found == expected:
        return "correct", "named every failure"
    if not found:
        return "missed", "named no root cause"
    if found > expected:
        return "extra", f"also blamed {', '.join(sorted(found - expected))}"
    if found & expected:
        return "partial", f"missed {', '.join(sorted(expected - found))}"
    return "wrong", f"blamed {', '.join(sorted(found))}"


Emit = Callable[[dict], Awaitable[None]]


async def run_case(graph: Graph, case: Case, toolbox: Any, llm: Any) -> dict[str, Any]:
    await asyncio.to_thread(apply_case, graph, case)
    events: list[dict] = []

    async def emit(e: dict) -> None:
        events.append(e)

    started = time.monotonic()
    try:
        final = await asyncio.wait_for(investigate("Alerts are firing. Investigate, find the root cause and fix it.", emit, toolbox, llm),
                                       CASE_TIMEOUT_S)
    except asyncio.TimeoutError:
        return {"id": case.id, "title": case.title, "difficulty": case.difficulty, "expected": case.expected, "found": [],
                "outcome": "timeout", "correct": False, "why": f"no answer in {CASE_TIMEOUT_S} s", "seconds": CASE_TIMEOUT_S,
                "steps": 0, "confidence": None, "provider": getattr(llm, "name", "?"), "fallback": False}
    outcome, why = judge(case, final)
    paged = {a["target"] for a in final.get("actions", []) if a.get("kind") == "page_oncall"}
    return {"id": case.id, "title": case.title, "difficulty": case.difficulty, "expected": case.expected,
            "found": final.get("root_causes") or ([final["root_cause"]] if final.get("root_cause") else []),
            "outcome": outcome, "correct": outcome == "correct", "why": why, "seconds": round(time.monotonic() - started, 1),
            "steps": final.get("steps", 0), "confidence": final.get("confidence"), "provider": final.get("provider"),
            "fallback": any(e.get("type") == "provider_fallback" for e in events),
            "paged_every_failure": bool(case.expected) and set(case.expected) <= paged}


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(results)
    correct = sum(r["correct"] for r in results)
    faults = [r for r in results if r["expected"]]
    return {"cases": n, "correct": correct, "accuracy": round(correct / n, 3) if n else None,
            "false_alarms": sum(r["outcome"] == "false-alarm" for r in results),
            "missed_or_wrong": sum(r["outcome"] in ("missed", "wrong", "partial", "extra", "timeout") for r in results),
            "paged_every_failure": sum(bool(r.get("paged_every_failure")) for r in faults), "faults": len(faults),
            "seconds": round(sum(r["seconds"] for r in results), 1), "fell_back_to_builtin": (fb := sum(r["fallback"] for r in results)),
            # Cases the chosen model really answered. A case it could not answer was handed to the built-in agent: not its score.
            "answered_by_chosen": n - fb,
            "accuracy_of_chosen": (round(sum(r["correct"] for r in results if not r["fallback"]) / (n - fb), 3) if n - fb else None),
            "by_difficulty": {d: [sum(1 for r in results if r["difficulty"] == d and r["correct"]),
                                  sum(1 for r in results if r["difficulty"] == d)] for d in ("easy", "medium", "hard")}}
