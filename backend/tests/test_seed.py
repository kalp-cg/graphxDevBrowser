import pytest

from graphq import all_uids, counts, dependency_edges, firing, firing_services, node_count, unhealthy
from sentinel.seed.generator import seed_baseline
from sentinel.seed.scenarios import SCENARIOS, inject_scenario


def test_baseline_is_deterministic(graph):
    first = seed_baseline(graph)
    uids_a = all_uids(graph)
    second = seed_baseline(graph)
    uids_b = all_uids(graph)
    assert first == second
    assert uids_a == uids_b


def test_baseline_shape(graph):
    seed_baseline(graph)
    by_type = counts(graph)
    assert by_type["Service"] >= 35
    assert by_type["Team"] == 8
    assert by_type["Incident"] == 3
    # uids are unique across vertex types (each type's primary id is the uid, so within a type it is enforced).
    uids = all_uids(graph)
    assert len(uids) == len(set(uids)) == sum(by_type.values())


def test_dependencies_are_a_dag(graph):
    seed_baseline(graph)
    deps: dict[str, list[str]] = {}
    for e in dependency_edges(graph):
        deps.setdefault(e["from_id"], []).append(e["to_id"])
    done: set[str] = set()

    def visit(node: str, path: set[str]) -> None:
        assert node not in path, f"cycle through {node}"
        if node not in done:
            for nxt in deps.get(node, []):
                visit(nxt, path | {node})
            done.add(node)

    for node in list(deps):
        visit(node, set())


def test_baseline_is_healthy_and_quiet(graph):
    seed_baseline(graph)
    assert unhealthy(graph) == set()
    assert firing(graph) == 0


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_scenario_fires_alerts(graph, name):
    info = inject_scenario(name, graph)
    assert firing_services(graph) == sorted(info["alerting_services"])


def test_unknown_scenario(graph):
    with pytest.raises(ValueError):
        inject_scenario("does-not-exist", graph)


def test_soft_reset_keeps_graph_stable(graph):
    inject_scenario("db-pool-exhaustion", graph, fresh=True)
    before = node_count(graph)
    for name in ("cache-stampede", "kafka-rebalance-storm", "db-pool-exhaustion"):
        inject_scenario(name, graph)
    after = node_count(graph)
    assert before == after
    # Only the current scenario's alerts fire and only its root is unhealthy.
    assert firing(graph) == 3
    assert len(unhealthy(graph)) == 4


def test_alert_ids_unique_across_fast_injections(graph):
    from sentinel.seed.scenarios import inject_chaos

    inject_scenario("db-pool-exhaustion", graph, fresh=True)
    a = inject_chaos("pricing-service", "down", False, graph)
    b = inject_chaos("pricing-service", "down", False, graph)
    assert not set(a["alert_uids"]) & set(b["alert_uids"])
