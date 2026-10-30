"""Faults that raise no errors: the service gets slow, or starves, and only its own history says so."""
from sentinel import baselines
from sentinel.ingest import metrics, otel
from sentinel.tools import rootcause

GRAPH = "Sentinel_test"


def span(trace, sid, parent, comp, ms, error=False):
    return otel.Span(trace=trace, id=sid, parent=parent, component=comp, kind=0, error=error, ms=ms, attrs={})


def batch(n, api_ms, db_ms, start=0):
    """n requests: web -> api -> db."""
    out = []
    for i in range(start, start + n):
        out += [span(f"t{i}", f"w{i}", "", "web", api_ms + 5), span(f"t{i}", f"a{i}", f"w{i}", "api", api_ms),
                span(f"t{i}", f"d{i}", f"a{i}", "db", db_ms)]
    return out


def status(graph):
    return {v["attributes"]["name"]: v["attributes"]["status"] for v in graph.getVertices("Service", select="name,status")}


def test_a_slow_service_is_unhealthy_with_no_errors_and_the_root_is_the_deepest_slow_one(graph, tmp_path, monkeypatch):
    from sentinel.schema import ensure_schema
    from sentinel.seed.generator import wipe

    monkeypatch.setattr(baselines, "_path", lambda g: tmp_path / f"b-{g}.json")
    wipe(graph)
    ensure_schema(graph)
    for i in range(6):                                                 # normal: it learns what normal is
        otel.ingest_spans(graph, batch(30, 100, 20, start=i * 30), at=i * 60_000)
    assert set(status(graph).values()) == {"healthy"}
    out = otel.ingest_spans(graph, batch(30, 520, 440, start=500), at=400_000)   # the db gets slow; api and web inherit it
    assert out["unhealthy"] == ["api", "db", "web"] and out["alerting"] == ["api", "db", "web"]
    roots = rootcause.find_root_causes(out["alerting"], graph)["result"]["roots"]
    assert [r["name"] for r in roots] == ["db"]
    alert = graph.getVertices("Alert", where='scenario="otel",status="firing"')[0]["attributes"]
    assert alert["metric"] == "p90_latency_ms"


def test_nothing_is_called_slow_before_normal_is_known_or_when_the_batch_is_tiny(graph, tmp_path, monkeypatch):
    from sentinel.schema import ensure_schema
    from sentinel.seed.generator import wipe

    monkeypatch.setattr(baselines, "_path", lambda g: tmp_path / f"b-{g}.json")
    wipe(graph)
    ensure_schema(graph)
    otel.ingest_spans(graph, batch(30, 100, 20), at=0)
    otel.ingest_spans(graph, batch(30, 900, 800, start=100), at=60_000)      # only one earlier batch: not enough to know
    assert set(status(graph).values()) == {"healthy"}
    for i in range(5):
        otel.ingest_spans(graph, batch(30, 100, 20, start=200 + i * 30), at=(2 + i) * 60_000)
    otel.ingest_spans(graph, batch(3, 900, 800, start=900), at=500_000)      # three requests prove nothing
    assert set(status(graph).values()) == {"healthy"}


def test_a_fault_is_never_learned_as_normal(tmp_path, monkeypatch):

    monkeypatch.setattr(baselines, "_path", lambda g: tmp_path / f"b-{g}.json")
    assert baselines.is_slow(500, [100, 101, 99, 100, 102], z=6, ratio=1.25)
    assert not baselines.is_slow(104, [100, 101, 99, 100, 102], z=6, ratio=1.25)
    assert not baselines.is_slow(500, [100, 101], z=6, ratio=1.25)


def series(service, metric, normal, now, n_old=60, n_new=30):
    pts = [[t, normal + (t % 3) * 0.01] for t in range(n_old)] + [[n_old + t, now + (t % 3) * 0.01] for t in range(n_new)]
    return {"service": service, "metric": metric, "points": pts}


def test_metrics_flag_the_service_whose_series_left_its_own_normal(graph):
    from sentinel.schema import ensure_schema
    from sentinel.seed.generator import wipe

    wipe(graph)
    ensure_schema(graph)
    out = metrics.ingest_metrics(graph, {"series": [series("cart", "cpu", 0.2, 0.9), series("cart", "mem", 50, 50),
                                                    series("ads", "cpu", 0.9, 0.9)], "recent_seconds": 30}, at=1000)
    assert out["unhealthy"] == ["cart"]                    # "ads" is busy all the time: not a fault
    assert status(graph) == {"ads": "healthy", "cart": "degraded"}
    assert out["strongest"][0]["metric"] == "cpu"
    back = metrics.ingest_metrics(graph, {"series": [series("cart", "cpu", 0.2, 0.2)], "recent_seconds": 30}, at=2000)
    assert back["resolved"] == ["cart"] and status(graph)["cart"] == "healthy"


def test_metrics_with_too_little_history_say_nothing():
    assert metrics.score_series([[t, 1.0] for t in range(5)], 2) is None
    assert metrics.score_series([], 60) is None
