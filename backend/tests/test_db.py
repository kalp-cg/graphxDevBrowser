from types import SimpleNamespace

import pytest

from sentinel import db


def settings(**over):
    base = dict(tg_host="https://x.i.tgcloud.io", tg_graph="Sentinel", tg_secret="s3cret", tg_token="",
                tg_username="tigergraph", tg_password="")
    return SimpleNamespace(**{**base, **over})


class FakeConn:
    minted = 0

    def __init__(self, **kw):
        self.kw = kw
        self.apiToken = kw["apiToken"]
        self.graphname = kw["graphname"]

    def getToken(self, secret):
        FakeConn.minted += 1
        return (f"tok-{secret}-{FakeConn.minted}", "expiry")


@pytest.fixture
def fake(monkeypatch):
    FakeConn.minted = 0
    monkeypatch.setattr(db, "TigerGraphConnection", FakeConn)
    monkeypatch.setattr(db, "_conns", {})
    monkeypatch.setattr(db, "_token", {"value": "", "at": 0.0})


def test_token_is_minted_from_the_secret_once(monkeypatch, fake):
    monkeypatch.setattr(db, "settings", settings())
    a = db.get_graph()
    b = db.get_graph()
    assert a is b and a.apiToken == "tok-s3cret-1" and FakeConn.minted == 1
    assert a.kw["tgCloud"] is True and a.graphname == "Sentinel"


def test_token_is_renewed_when_old(monkeypatch, fake):
    monkeypatch.setattr(db, "settings", settings())
    first = db.get_graph()
    db._token["at"] -= db.TOKEN_MAX_AGE_S + 1
    assert db.get_graph().apiToken == "tok-s3cret-2" != first.apiToken


def test_bare_token_without_secret(monkeypatch, fake):
    monkeypatch.setattr(db, "settings", settings(tg_secret="", tg_host="http://localhost:14240"))
    monkeypatch.setattr(db, "_token", {"value": "given", "at": 0.0})
    g = db.get_graph("Other")
    assert g.apiToken == "given" and FakeConn.minted == 0
    assert g.kw["tgCloud"] is False and g.graphname == "Other"


def test_flat_strips_aliases_and_accumulator_marks():
    printed = [{"v_id": "svc:a", "v_type": "Service", "attributes": {"S.name": "a", "S.@dist": {"a": 0}, "tier": "x"}}]
    assert db.flat(printed) == [{"uid": "svc:a", "name": "a", "dist": {"a": 0}, "tier": "x"}]


def test_run_query_installed_and_fallback():
    class MockGraph:
        installed_called = False
        interpreted_called = False

        def runInstalledQuery(self, query_name, params):
            self.installed_called = True
            if query_name == "installed_ok":
                return [{"res": 42}]
            raise RuntimeError("query not installed")

        def runInterpretedQuery(self, gsql, params):
            self.interpreted_called = True
            return [{"fallback": 99}]

    g = MockGraph()
    # Installed succeeds
    res1 = db.run(g, "GSQL...", query_name="installed_ok")
    assert res1 == {"res": 42} and g.installed_called

    # Installed fails -> falls back to interpreted
    g.installed_called = False
    res2 = db.run(g, "GSQL...", query_name="not_installed")
    assert res2 == {"fallback": 99} and g.installed_called and g.interpreted_called

