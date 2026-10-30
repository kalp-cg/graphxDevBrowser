"""Run the whole sandbox shop in one process: seven services, a control endpoint and steady traffic.

    python sandbox/shop/run_shop.py --sentinel http://localhost:8200

Control (what SentinelGraph's `sandbox` action adapter and the sandbox CLI call), on port 7499:

    POST /__control {"action": "fault", "service": "inventory", "rate": 0.6,
                     "deploy": {"version": "v2.4.1", "message": "...", "author": "Priya Shah"}}
    POST /__control {"action": "rollback" | "scale_up" | "open_breaker", "service": "inventory"}
    POST /__control {"action": "reset"}
    GET  /__control                         -> faults, open breakers, versions, exporter stats

A fault with a `deploy` also records that deploy in SentinelGraph (`POST /api/changes`), the way a CD
pipeline would, so the agent can find the change that broke the service.
"""
import argparse
import importlib.util
import json
import random
import secrets
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import shoplib  # noqa: E402
from shoplib import PORTS, STATE, Exporter  # noqa: E402

CONTROL_PORT = 7499
# (service, method, path, body, weight): customers load the storefront, then use the API through the gateway.
TRAFFIC = [("web", "GET", "/", None, 2), ("gateway", "GET", "/api/products", None, 5), ("gateway", "GET", "/api/cart", None, 3),
           ("gateway", "POST", "/api/cart", {"sku": "mug"}, 2), ("gateway", "POST", "/api/checkout", {}, 3)]


def load_services() -> list[shoplib.Service]:
    out = []
    for name in PORTS:
        spec = importlib.util.spec_from_file_location(f"shop_{name}", HERE / "services" / name / "app.py")
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        out.append(mod.svc)
    return out


class Shop:
    def __init__(self, sentinel: str, rps: float, interval: float = 2.0) -> None:
        self.sentinel, self.rps = sentinel.rstrip("/"), rps
        self.exporter = shoplib.EXPORTER = Exporter(sentinel, interval)
        self.servers: list[ThreadingHTTPServer] = []
        self.requests = self.errors = 0

    def start(self) -> "Shop":
        for svc in load_services():
            self.servers.append(svc.server())
        self.servers.append(self._control_server())
        for srv in self.servers:
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        threading.Thread(target=self.exporter.run_forever, daemon=True).start()
        if self.rps > 0:
            threading.Thread(target=self._traffic, daemon=True).start()
        return self

    def stop(self) -> None:
        for srv in self.servers:
            srv.shutdown()
            srv.server_close()

    def _traffic(self) -> None:
        """Steady customer traffic, so the graph always has a current picture of health."""
        weights = [w for *_x, w in TRAFFIC]
        while True:
            service, method, path, body, _w = random.choices(TRAFFIC, weights)[0]
            self.requests += 1
            try:
                req = urllib.request.Request(f"http://localhost:{PORTS[service]}{path}",
                                             json.dumps(body).encode() if body is not None else None,
                                             method=method, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=5).read()
            except Exception:  # noqa: BLE001 - failures are the point; they are traced by the services
                self.errors += 1
            time.sleep(1 / self.rps)

    def control(self, cmd: dict[str, Any]) -> dict[str, Any]:
        action, service = cmd.get("action"), cmd.get("service", "")
        if action != "reset" and service not in PORTS:
            raise ValueError(f"unknown service {service!r}; one of {sorted(PORTS)}")
        with STATE.lock:
            if action == "fault":
                STATE.faults[service] = float(cmd.get("rate", 0.6))
                deploy = cmd.get("deploy")
                if deploy:
                    STATE.version[service] = deploy["version"]
                detail = f"{service} failing {STATE.faults[service]:.0%} of requests"
            elif action in ("rollback", "scale_up"):
                STATE.faults.pop(service, None)
                STATE.open_breakers.discard(service)
                if action == "rollback":
                    STATE.version.pop(service, None)
                detail = f"{action} {service}: healthy again"
            elif action == "open_breaker":
                STATE.open_breakers.add(service)
                detail = f"callers of {service} now fall back instead of calling it"
            elif action == "reset":
                STATE.faults.clear()
                STATE.open_breakers.clear()
                STATE.version.clear()
                detail = "all services healthy"
            else:
                raise ValueError(f"unknown action {action!r}")
        if action in ("rollback", "scale_up", "reset"):
            # A deploy boundary: spans recorded before the fix must not be reported as current failures.
            self.exporter.drop()
        if action == "fault" and cmd.get("deploy"):
            self._record_deploy(service, cmd["deploy"])
        return {"ok": True, "detail": detail, **self.state()}

    def _record_deploy(self, service: str, deploy: dict[str, Any]) -> None:
        body = {"service": service, "version": deploy["version"], "author": deploy.get("author", "Sandbox CI"),
                "message": deploy.get("message", "sandbox deploy"), "sha": secrets.token_hex(5),
                "files": deploy.get("files", [f"services/{service}/app.py"])}
        req = urllib.request.Request(f"{self.sentinel}/api/changes", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()

    def state(self) -> dict[str, Any]:
        return {"faults": dict(STATE.faults), "open_breakers": sorted(STATE.open_breakers),
                "versions": dict(STATE.version), "requests": self.requests, "errors": self.errors,
                "exports": {"sent": self.exporter.sent, "failed": self.exporter.failed}}

    def _control_server(self) -> ThreadingHTTPServer:
        shop = self

        class H(BaseHTTPRequestHandler):
            def _json(self, status: int, body: dict) -> None:
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self) -> None:  # noqa: N802
                self._json(200, shop.state())

            def do_POST(self) -> None:  # noqa: N802
                try:
                    cmd = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                    self._json(200, shop.control(cmd))
                except (ValueError, KeyError) as exc:
                    self._json(400, {"ok": False, "detail": str(exc)})
                except OSError as exc:
                    self._json(502, {"ok": False, "detail": f"could not reach SentinelGraph: {exc}"})

            def log_message(self, *_: Any) -> None:
                pass

        return ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), H)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--sentinel", default="http://localhost:8200")
    parser.add_argument("--rps", type=float, default=6.0, help="background customer requests per second")
    args = parser.parse_args()
    Shop(args.sentinel, args.rps).start()
    print(f"shop: storefront http://localhost:{PORTS['web']}  gateway http://localhost:{PORTS['gateway']}  "
          f"control http://localhost:{CONTROL_PORT}/__control", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
