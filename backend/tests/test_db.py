from sentinel import db


def test_flat_strips_aliases_and_accumulator_marks():
    printed = [{"v_id": "svc:a", "v_type": "Service", "attributes": {"S.name": "a", "S.@dist": {"a": 0}, "tier": "x"}}]
    assert db.flat(printed) == [{"uid": "svc:a", "name": "a", "dist": {"a": 0}, "tier": "x"}]


def test_run_merges_everything_the_query_prints():
    class FakeGraph:
        def runInterpretedQuery(self, gsql, params):
            assert params == {"keep": 1}  # None values are dropped
            return [{"A": [1]}, {"B": [2]}]

    assert db.run(FakeGraph(), "GSQL...", {"keep": 1, "drop": None}) == {"A": [1], "B": [2]}
