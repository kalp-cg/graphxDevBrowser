"""A tiny service framework for the sandbox shop: HTTP routes, W3C trace propagation, OTLP export, faults.

Standard library only. Every service is a `Service` with routes; a request handler calls other services with
`req.call(...)` and databases with `req.db(...)`, and every hop becomes an OpenTelemetry span with the right
parent, exported as OTLP/JSON to SentinelGraph's `/v1/traces`. That is the same data a real system sends
through an OpenTelemetry Collector, so the graph, health and alerts are built the way they would be in
production, not scripted.

Faults are switched on through the control endpoint (see run_shop.py): a faulty service fails a share of its
work at the source (its own database call, or the handler itself if it has none), and the failure travels up
the call chain as 5xx responses.
"""
import json
import os
import random
import secrets
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

# Published ports, as in docker-compose.yml. In compose, <NAME>_URL env vars point at the containers instead.
PORTS = {"web": 7400, "gateway": 7401, "catalog": 7402, "cart": 7403, "checkout": 7404, "payments": 7405,
         "inventory": 7406}
DB_SYSTEMS = {"orders-db": "postgresql", "cache": "redis"}


def address(service: str) -> str:
    return os.getenv(f"{service.upper()}_URL", f"http://localhost:{PORTS[service]}")


class State:
    """Faults and breakers, shared by every service in the process (changed through the control endpoint)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.faults: dict[str, float] = {}       # service -> share of requests that fail at the source
        self.open_breakers: set[str] = set()     # callers skip calls into these services and fall back
        self.version: dict[str, str] = {}

    def fault_rate(self, service: str) -> float:
        with self.lock:
            return self.faults.get(service, 0.0)


STATE = State()


class Exporter:
    """Buffers finished spans and posts them to SentinelGraph as one OTLP/JSON payload every `interval` s."""

    def __init__(self, url: str, interval: float = 2.0) -> None:
        self.url, self.interval = url.rstrip("/"), interval
        self.lock = threading.Lock()
        self.spans: dict[str, list[dict]] = {}
        self.sent = self.failed = 0

    def add(self, service: str, span: dict) -> None:
        with self.lock:
            self.spans.setdefault(service, []).append(span)

    def drop(self) -> None:
        """Forget unsent spans. Used at a deploy boundary (rollback), so stale failures aren't reported late."""
        with self.lock:
            self.spans = {}

    def flush(self) -> int:
        with self.lock:
            spans, self.spans = self.spans, {}
        if not spans:
            return 0
        payload = {"resourceSpans": [
            {"resource": {"attributes": _attrs({"service.name": svc, "telemetry.sdk.language": "python",
                                                "service.version": STATE.version.get(svc, "v1.0.0")})},
             "scopeSpans": [{"spans": s}]} for svc, s in spans.items()]}
        req = urllib.request.Request(f"{self.url}/v1/traces", json.dumps(payload).encode(),
                                     {"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=10).read()
            self.sent += 1
        except (urllib.error.URLError, OSError):
            self.failed += 1  # SentinelGraph away: these spans are lost, like a collector with no retry
        return sum(len(s) for s in spans.values())

    def run_forever(self) -> None:
        while True:
            time.sleep(self.interval)
            self.flush()


EXPORTER: Exporter | None = None


def _attrs(values: dict[str, Any]) -> list[dict]:
    out = []
    for k, v in values.items():
        out.append({"key": k, "value": {"intValue": str(v)} if isinstance(v, int) and not isinstance(v, bool)
                    else {"stringValue": str(v)}})
    return out


class UpstreamError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


class Span:
    def __init__(self, service: str, name: str, kind: int, trace: str, parent: str, attrs: dict) -> None:
        self.service, self.name, self.kind, self.trace, self.parent = service, name, kind, trace, parent
        self.id = secrets.token_hex(8)
        self.attrs = attrs
        self.start = time.time_ns()
        self.error = False

    def end(self) -> None:
        if EXPORTER:
            EXPORTER.add(self.service, {
                "traceId": self.trace, "spanId": self.id, "parentSpanId": self.parent, "name": self.name,
                "kind": self.kind, "startTimeUnixNano": str(self.start), "endTimeUnixNano": str(time.time_ns()),
                "attributes": _attrs(self.attrs), "status": {"code": 2 if self.error else 0}})


class Request:
    def __init__(self, service: "Service", method: str, path: str, body: Any, span: Span) -> None:
        self.service, self.method, self.path, self.body, self.span = service, method, path, body, span
        self.db_calls = 0

    def call(self, target: str, method: str, path: str, body: Any = None, fallback: Any = None) -> Any:
        """Call another service. A 5xx raises UpstreamError; an open breaker returns `fallback` instead."""
        if target in STATE.open_breakers:
            return fallback
        span = Span(self.service.name, f"{method} {target}", 3, self.span.trace, self.span.id,
                    {"http.request.method": method, "server.address": target})
        try:
            data = json.dumps(body).encode() if body is not None else None
            req = urllib.request.Request(f"{address(target)}{path}", data, method=method, headers={
                "Content-Type": "application/json", "traceparent": f"00-{span.trace}-{span.id}-01"})
            with urllib.request.urlopen(req, timeout=5) as r:
                span.attrs["http.response.status_code"] = r.status
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as exc:
            span.attrs["http.response.status_code"] = exc.code
            span.error = exc.code >= 500
            raise UpstreamError(502 if exc.code >= 500 else exc.code, f"{target} returned {exc.code}") from None
        except (urllib.error.URLError, OSError) as exc:
            span.error = True
            raise UpstreamError(502, f"{target} unreachable: {exc}") from None
        finally:
            span.end()

    def db(self, name: str, operation: str) -> None:
        """A database call. A faulty service fails here: this is where its errors originate."""
        self.db_calls += 1
        span = Span(self.service.name, f"{operation} {name}", 3, self.span.trace, self.span.id,
                    {"db.system": DB_SYSTEMS[name], "db.name": name, "db.operation": operation})
        time.sleep(random.uniform(0.001, 0.004))
        try:
            if random.random() < STATE.fault_rate(self.service.name):
                span.error = True
                raise UpstreamError(500, f"{name}: connection pool exhausted")
        finally:
            span.end()


Handler = Callable[[Request], tuple[int, Any]]


class Service:
    def __init__(self, name: str) -> None:
        self.name = name
        self.routes: dict[tuple[str, str], Handler] = {}
        self.static: dict[str, tuple[str, bytes]] = {}

    def route(self, method: str, path: str) -> Callable[[Handler], Handler]:
        def register(fn: Handler) -> Handler:
            self.routes[(method, path)] = fn
            return fn
        return register

    def handle(self, method: str, path: str, headers: Any, raw: bytes) -> tuple[int, str, bytes]:
        key = path.split("?")[0]
        static = self.static.get(key) if method == "GET" else None
        fn = self.routes.get((method, key))
        if fn is None and static is None:
            return 404, "application/json", b'{"error": "not found"}'
        parts = (headers.get("traceparent") or "").split("-")
        trace, parent = (parts[1], parts[2]) if len(parts) == 4 else (secrets.token_hex(16), "")
        span = Span(self.name, f"{method} {key}", 2, trace, parent, {"http.request.method": method, "url.path": key})
        try:
            req = Request(self, method, key, json.loads(raw) if raw else None, span)
            status, body = fn(req) if fn else (200, None)
            if not req.db_calls and random.random() < STATE.fault_rate(self.name):
                raise UpstreamError(500, f"{self.name}: unhandled exception in {key}")  # no database to blame
        except UpstreamError as exc:
            status, body = exc.status, {"error": str(exc)}
        span.attrs["http.response.status_code"] = status
        span.error = status >= 500
        span.end()
        if static and status == 200:
            return status, static[0], static[1]
        return status, "application/json", json.dumps(body).encode()

    def server(self, port: int | None = None, host: str = "127.0.0.1") -> ThreadingHTTPServer:
        service = self

        class H(BaseHTTPRequestHandler):
            def _reply(self, method: str) -> None:
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if method == "POST" else b""
                status, ctype, body = service.handle(method, self.path, self.headers, raw)
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")  # the storefront calls the gateway
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802
                self._reply("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._reply("POST")

            def do_OPTIONS(self) -> None:  # noqa: N802
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, traceparent")
                self.send_header("Access-Control-Allow-Methods", "GET, POST")
                self.end_headers()

            def log_message(self, *_: Any) -> None:
                pass

        return ThreadingHTTPServer((host, port or PORTS[self.name]), H)

    def serve(self) -> None:
        """Run this one service (the compose / one-process-per-service way)."""
        global EXPORTER
        EXPORTER = Exporter(os.getenv("SENTINEL_URL", "http://localhost:8200"))
        threading.Thread(target=EXPORTER.run_forever, daemon=True).start()
        self.server(int(os.getenv("PORT", PORTS[self.name])), "0.0.0.0").serve_forever()
