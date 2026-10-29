"""A sandbox when no real system is available: synthetic OpenTelemetry traffic in OTLP/JSON.

`microservices` follows the OpenTelemetry Demo ("Astronomy Shop", github.com/open-telemetry/opentelemetry-demo):
the same services, call paths and fault flags (its flagd feature flags). `monolith` is one deployable
(`shop-monolith`) whose spans carry `code.namespace`, the way OpenTelemetry auto-instrumentation tags code in a
single process.

Both go through the real ingest path (otel.py), so pointing the actual OpenTelemetry Demo's collector at
`POST /v1/traces` replaces this module without any other change.
"""
import random
from typing import Any

# component -> (team, tier, language)
MICROSERVICES = {
    "frontend-proxy": ("edge", "critical", "cpp"),
    "frontend": ("web", "critical", "typescript"),
    "ad": ("growth", "low", "java"),
    "cart": ("checkout", "critical", "dotnet"),
    "checkout": ("checkout", "critical", "go"),
    "currency": ("payments", "high", "cpp"),
    "email": ("growth", "low", "ruby"),
    "payment": ("payments", "critical", "javascript"),
    "product-catalog": ("catalog", "high", "go"),
    "quote": ("shipping", "medium", "php"),
    "recommendation": ("growth", "medium", "python"),
    "shipping": ("shipping", "high", "rust"),
}

# A user journey is a call tree: (component, [children]). Database calls are ("db", name, system, operation).
BROWSE = ("frontend-proxy", [("frontend", [("product-catalog", []), ("ad", []), ("currency", []),
                                           ("recommendation", [("product-catalog", [])])])])
ADD_TO_CART = ("frontend-proxy", [("frontend", [("cart", [("db", "valkey-cart", "redis", "HSET")]),
                                                ("product-catalog", [])])])
CHECKOUT = ("frontend-proxy", [("frontend", [("checkout", [
    ("cart", [("db", "valkey-cart", "redis", "HGET")]), ("product-catalog", []), ("currency", []),
    ("shipping", [("quote", [])]), ("payment", []), ("email", []),
])])])
JOURNEYS = [(BROWSE, 0.55), (ADD_TO_CART, 0.25), (CHECKOUT, 0.2)]

# OpenTelemetry Demo flagd flags -> (component that fails, the change that turned it on)
FAULTS = {
    "paymentFailure": ("payment", "Enable flag paymentFailure: charge requests fail for 60% of cards"),
    "cartFailure": ("cart", "Enable flag cartFailure: cart can't reach valkey-cart"),
    "productCatalogFailure": ("product-catalog", "Enable flag productCatalogFailure: GetProduct fails"),
    "adFailure": ("ad", "Enable flag adFailure: GetAds throws"),
}
FAILURE_RATE = 0.6

# A monolith: one service, modules calling modules in-process. module -> (team, tier)
MONOLITH = "shop-monolith"
MODULES = {
    "shop.web": ("web", "critical"), "shop.orders": ("checkout", "critical"), "shop.cart": ("checkout", "critical"),
    "shop.catalog": ("catalog", "high"), "shop.inventory": ("fulfillment", "critical"),
    "shop.payments": ("payments", "critical"), "shop.pricing": ("catalog", "high"),
    "shop.notifications": ("growth", "low"),
}
MONOLITH_JOURNEYS = [
    (("shop.web", [("shop.catalog", [("shop.pricing", []), ("db", "shopdb", "postgresql", "SELECT")])]), 0.5),
    (("shop.web", [("shop.cart", [("shop.inventory", [("db", "shopdb", "postgresql", "SELECT")]),
                                  ("shop.pricing", [])])]), 0.3),
    (("shop.web", [("shop.orders", [("shop.cart", []), ("shop.inventory", [("db", "shopdb", "postgresql",
                                                                             "UPDATE")]),
                                    ("shop.payments", []), ("shop.notifications", [])])]), 0.2),
]
MONOLITH_FAULTS = {
    "inventoryLockTimeout": ("shop.inventory", "Wrap stock reservation in SERIALIZABLE transaction"),
    "pricingNullRule": ("shop.pricing", "Apply promo rules before base price is loaded"),
}


class _Tracer:
    def __init__(self, rng: random.Random, failing: str | None, mode: str):
        self.rng, self.failing, self.mode = rng, failing, mode
        self.spans: dict[str, list[dict]] = {}  # resource key -> spans
        self.t = 1_700_000_000_000_000_000

    def _id(self, n: int) -> str:
        return "".join(self.rng.choice("0123456789abcdef") for _ in range(n))

    def _span(self, owner: str, trace: str, parent: str, name: str, kind: int, error: bool,
              attrs: dict[str, Any], ms: float) -> str:
        sid = self._id(16)
        self.t += int(ms * 1e6)
        if self.mode == "monolith":
            attrs = {**attrs, "code.namespace": owner}
        key = MONOLITH if self.mode == "monolith" else owner
        self.spans.setdefault(key, []).append({
            "traceId": trace, "spanId": sid, "parentSpanId": parent, "name": name, "kind": kind,
            "startTimeUnixNano": str(self.t), "endTimeUnixNano": str(self.t + int(ms * 1e6)),
            "attributes": [{"key": k, "value": {"stringValue": str(v)}} for k, v in attrs.items()],
            "status": {"code": 2 if error else 0},
        })
        return sid

    def call(self, node: tuple, trace: str, parent: str) -> bool:
        """Emit the spans of one call (and its subtree). Returns True if it failed."""
        if node[0] == "db":
            raise ValueError("database calls are emitted by their caller")
        comp, children = node
        server = self._span(comp, trace, parent, f"{comp}/handle", 2, False, {"rpc.system": "grpc"}, 0)
        failed = comp == self.failing and self.rng.random() < FAILURE_RATE
        for child in children:
            if child[0] == "db":
                _, db, system, op = child
                self._span(comp, trace, server, f"{op} {db}", 3, False,
                           {"db.system": system, "db.name": db, "db.operation": op}, 1.5)
                continue
            client = self._span(comp, trace, server, f"call {child[0]}", 3, False, {"rpc.system": "grpc"}, 4)
            if self.call(child, trace, client):
                self._mark_error(comp, client)
                failed = True
        if failed:
            self._mark_error(comp, server)
        return failed

    def _mark_error(self, owner: str, span_id: str) -> None:
        key = MONOLITH if self.mode == "monolith" else owner
        next(s for s in self.spans[key] if s["spanId"] == span_id)["status"]["code"] = 2


def traffic(mode: str = "microservices", fault: str | None = None, requests: int = 300,
            seed: int = 7) -> dict[str, Any]:
    """OTLP/JSON for `requests` user journeys, with `fault` (a flag from FAULTS / MONOLITH_FAULTS) switched on."""
    monolith = mode == "monolith"
    faults = MONOLITH_FAULTS if monolith else FAULTS
    if fault and fault not in faults:
        raise ValueError(f"unknown fault {fault!r}; choose one of {sorted(faults)}")
    rng = random.Random(seed)
    tracer = _Tracer(rng, faults[fault][0] if fault else None, mode)
    journeys = MONOLITH_JOURNEYS if monolith else JOURNEYS
    for _ in range(requests):
        tree = rng.choices([j for j, _w in journeys], [w for _j, w in journeys])[0]
        tracer.call(tree, tracer._id(32), "")
    resources = []
    for key, spans in tracer.spans.items():
        if monolith:
            res = {"service.name": MONOLITH, "service.version": "2026.10.1", "telemetry.sdk.language": "python"}
        else:
            team, tier, lang = MICROSERVICES[key]
            res = {"service.name": key, "service.team": team, "service.tier": tier, "service.version": "2.1.3",
                   "telemetry.sdk.language": lang}
        resources.append({"resource": {"attributes": [{"key": k, "value": {"stringValue": v}}
                                                      for k, v in res.items()]},
                          "scopeSpans": [{"scope": {"name": "sandbox"}, "spans": spans}]})
    return {"resourceSpans": resources}


def load(graph, mode: str = "microservices", fault: str | None = None, requests: int = 300) -> dict[str, Any]:
    """Wipe `graph` and load the sandbox: healthy traffic first (the full topology), then, with a fault, the
    change that caused it (5 minutes ago) and a window of failing traffic."""
    from ..db import Batch, link, upsert
    from ..schema import ensure_schema
    from ..seed.generator import on_call_window, wipe
    from ..tools.common import now_ms
    from .monolith import write_modules
    from .otel import ingest_traces, record_change

    monolith = mode == "monolith"
    component = "module" if monolith else "service"
    ensure_schema(graph)
    wipe(graph)
    if monolith:
        write_modules(graph, set(MODULES), set(), [], owners=MODULES)
    teams = sorted({t for t, *_ in (MODULES if monolith else MICROSERVICES).values()})
    batch = Batch()
    upsert(batch, "Team", [{"uid": f"team:{t}", "name": t, "slack_channel": f"#team-{t}"} for t in teams])
    upsert(batch, "Person", [{"uid": f"person:oncall-{t}", "handle": f"oncall-{t}", "name": f"{t} on-call",
                              "role": "SRE"} for t in teams])
    link(batch, "Person", "MEMBER_OF", "Team", [(f"person:oncall-{t}", f"team:{t}") for t in teams])
    link(batch, "Person", "ON_CALL", "Team", [(f"person:oncall-{t}", f"team:{t}", on_call_window()) for t in teams])
    batch.send(graph)
    out = {"baseline": ingest_traces(graph, traffic(mode, None, requests), component)}
    if fault:
        target, message = (MONOLITH_FAULTS if monolith else FAULTS)[fault]
        team = (MODULES[target][0] if monolith else MICROSERVICES[target][0])
        record_change(graph, target, f"flag-{fault}" if not monolith else "a1b2c3d", now_ms() - 5 * 60_000,
                      f"oncall-{team}", message, f"{fault.lower()[:10]}", origin="sandbox")
        out["incident"] = ingest_traces(graph, traffic(mode, fault, requests, seed=8), component)
    return out
