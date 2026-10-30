"""The SentinelGraph + DevBrowser sandbox: a live system to try the whole product on, with no cloud account.

    python sandbox/run.py up            # API (embedded graph) + shop + traffic; --ui also starts the dashboard
    python sandbox/run.py break inventory   # a bad deploy: inventory starts failing
    python sandbox/run.py investigate   # the agent finds the root cause and proposes fixes
    python sandbox/run.py approve rollback  # a human approves; the shop really rolls back
    python sandbox/run.py status        # graph health, firing alerts, shop state
    python sandbox/run.py demo          # all of the above, end to end, and checks each step (exit 1 if not)

`up` scans sandbox/shop as a codebase first (services, dependencies, owners and addresses from its compose
file, CODEOWNERS and git), then lets real traces build health on top. Browse http://localhost:7400 in
DevBrowser (Settings -> Integrations -> SentinelGraph: http://localhost:8200) and the
requests it captures land on the same services.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DATA = ROOT / "sandbox" / ".data"
API = os.getenv("SANDBOX_API", "http://localhost:8200")
CONTROL = "http://localhost:7499/__control"
PYTHON = str(BACKEND / ".venv" / "bin" / "python") if (BACKEND / ".venv" / "bin" / "python").exists() else sys.executable
BAD_DEPLOYS = {
    "inventory": ("v2.4.1", "Reduce orders-db pool size to 2 to cut connection costs", "Priya Shah"),
    "payments": ("v3.0.0", "Switch card processor client to async retries", "Dan Okafor"),
    "cart": ("v1.9.0", "Move cart sessions to new cache keyspace", "Eva Lindqvist"),
    "catalog": ("v5.2.0", "Precompute product listing in cache", "Zoe Martin"),
}


def env() -> dict[str, str]:
    """The API's environment: embedded graph, sandbox actions applied for real, deterministic agent."""
    return {**os.environ, "GRAPH_BACKEND": "local", "LOCAL_GRAPH_DIR": str(DATA), "TG_GRAPH": "Sandbox",
            "ACTION_ADAPTER": "sandbox", "ACTIONS_MODE": "live",
            "SANDBOX_URL": CONTROL.removesuffix("/__control"),
            "LLM_PROVIDER": os.getenv("SANDBOX_LLM", "autopilot"), "AUTOPILOT_DELAY_S": os.getenv("AUTOPILOT_DELAY_S", "0.4"),
            "CORS_ORIGINS": "http://localhost:3002", "PYTHONUNBUFFERED": "1"}


def http(method: str, url: str, body: Any = None, timeout: float = 30) -> Any:
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def wait_for(url: str, seconds: float = 30) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except (urllib.error.URLError, OSError):
            time.sleep(0.3)
    raise SystemExit(f"timed out waiting for {url}")


def up(args: argparse.Namespace) -> None:
    if not args.keep and DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(parents=True, exist_ok=True)
    scan = subprocess.run([PYTHON, "-m", "sentinel.ingest", "--graph", "Sandbox", "codebase",
                           str(ROOT / "sandbox" / "shop")], cwd=BACKEND, env=env(), capture_output=True, text=True)
    if scan.returncode:
        raise SystemExit(f"codebase scan failed:\n{scan.stderr}")
    print(f"scanned sandbox/shop: {json.loads(scan.stdout)}")

    procs = [subprocess.Popen([PYTHON, "-m", "uvicorn", "sentinel.api.main:app", "--port", API.rsplit(":", 1)[1],
                               "--log-level", "warning"], cwd=BACKEND, env=env())]
    wait_for(f"{API}/api/health")
    procs.append(subprocess.Popen([PYTHON, str(ROOT / "sandbox" / "shop" / "run_shop.py"), "--sentinel", API,
                                   "--rps", str(args.rps)], env=env()))
    wait_for(CONTROL)
    if args.ui:
        procs.append(subprocess.Popen(["npm", "run", "dev", "--", "-p", "3002"], cwd=ROOT / "frontend",
                                      env={**os.environ, "NEXT_PUBLIC_API_URL": API}))
    print(f"""
sandbox is up
  storefront   http://localhost:7400      (browse it in DevBrowser)
  API          {API}
  dashboard    {"http://localhost:3002" if args.ui else "python sandbox/run.py up --ui"}
  DevBrowser   Settings -> Integrations -> SentinelGraph: {API}

try:  python sandbox/run.py break inventory   then   investigate   then   approve rollback
Ctrl+C stops everything.""", flush=True)

    def stop(*_: Any) -> None:
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait(timeout=10)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(1)
        print("a sandbox process exited; stopping", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    stop()


def break_service(args: argparse.Namespace) -> dict:
    version, message, author = BAD_DEPLOYS.get(args.service, ("v9.9.9", f"Risky change to {args.service}", "Sandbox CI"))
    cmd = {"action": "fault", "service": args.service, "rate": args.rate}
    if not args.no_deploy:
        cmd["deploy"] = {"version": version, "message": message, "author": author}
    out = http("POST", CONTROL, cmd)
    print(out["detail"] + (f" (deployed {version}: {message!r} by {author})" if not args.no_deploy else ""))
    return out


def firing() -> list[str]:
    nodes = http("GET", f"{API}/api/graph")["nodes"]
    return sorted(n["id"] for n in nodes if n["type"] == "Alert")


def investigate(_args: argparse.Namespace | None = None) -> dict:
    run_id = http("POST", f"{API}/api/runs", {})["run_id"]
    print(f"investigation {run_id} started")
    seen = 0
    while True:
        cur = http("GET", f"{API}/api/runs/current")
        if cur["run_id"] != run_id:
            raise SystemExit(f"another run ({cur['run_id']}) replaced {run_id}")
        for e in cur["events"][seen:]:
            if e["type"] == "tool_call":
                print(f"  -> {e.get('name')} {json.dumps(e.get('args', {}))}")
            elif e["type"] == "action_proposed":
                a = e.get("action", {})
                print(f"  ** proposed {a.get('kind')} on {a.get('target')} ({a.get('uid')})")
            elif e["type"] in ("final", "error"):
                print(f"\n{e.get('report') or e.get('message')}")
                return e
        seen = len(cur["events"])
        time.sleep(0.5)


def approve(args: argparse.Namespace) -> list[dict]:
    done = []
    for a in http("GET", f"{API}/api/actions?status=pending"):
        if args.kind in (None, a["kind"]):
            out = http("POST", f"{API}/api/actions/{a['uid']}/approve")
            print(f"approved {a['kind']} on {a['target']}: {out['outcome']}")
            done.append(out)
    if not done:
        print("nothing pending" + (f" of kind {args.kind}" if args.kind else ""))
    return done


def status(_args: argparse.Namespace | None = None) -> dict:
    g = http("GET", f"{API}/api/graph")
    services = {n["name"]: n["status"] for n in g["nodes"] if n["type"] == "Service"}
    shop = http("GET", CONTROL)
    out = {"unhealthy": {k: v for k, v in services.items() if v != "healthy"}, "firing_alerts": firing(),
           "shop": shop}
    print(json.dumps(out, indent=2))
    return out


def demo(args: argparse.Namespace) -> None:
    """The whole loop against a running sandbox, checking every step. Exit code 1 on the first failure."""
    def check(ok: bool, what: str) -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {what}", flush=True)
        if not ok:
            raise SystemExit(1)

    http("POST", CONTROL, {"action": "reset"})
    deadline = time.time() + 40  # alerts resolve only after a sustained healthy window (OTEL_RECOVERY_MS)
    while time.time() < deadline and firing():
        time.sleep(1)
    check(not firing(), "healthy baseline: no alerts firing")
    args.no_deploy = False
    break_service(args)
    deadline = time.time() + 30
    while time.time() < deadline and not firing():
        time.sleep(1)
    check(bool(firing()), f"traces turned the failure into alerts: {firing()}")
    final = investigate()
    check(final.get("root_cause") == args.service, f"agent named the root cause: {final.get('root_cause')}")
    kinds = {a["kind"] for a in final.get("actions", [])}
    check("rollback" in kinds, f"agent proposed a rollback (proposed: {sorted(kinds)})")
    args.kind = "rollback"
    out = approve(args)
    check(bool(out) and "sandbox:" in out[0]["outcome"], "approval executed against the running shop")
    check(not http("GET", CONTROL)["faults"], "the shop is healthy again")
    time.sleep(6)
    check(not firing(), "next trace windows are healthy: alerts stay resolved")
    incidents = http("GET", f"{API}/api/incidents")
    check(incidents[0]["status"] == "resolved" and incidents[0]["root_cause_service"] == args.service,
          f"incident {incidents[0]['id']} resolved and remembered with root cause {args.service}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("up", help="start the sandbox (Ctrl+C stops it)")
    p.add_argument("--ui", action="store_true", help="also start the web dashboard on :3002")
    p.add_argument("--keep", action="store_true", help="keep the graph from the last run (incident memory)")
    p.add_argument("--rps", type=float, default=6.0)
    for name in ("break", "demo"):
        p = sub.add_parser(name, help="break a service with a bad deploy" if name == "break" else "run the full loop")
        p.add_argument("service", nargs="?" if name == "demo" else None, default="inventory",
                       choices=["web", "gateway", "catalog", "cart", "checkout", "payments", "inventory"])
        p.add_argument("--rate", type=float, default=0.6, help="share of requests that fail")
        p.add_argument("--no-deploy", action="store_true", help="fail without a deploy (no change to blame)")
    sub.add_parser("investigate", help="start an investigation and follow it")
    p = sub.add_parser("approve", help="approve pending actions")
    p.add_argument("kind", nargs="?", choices=["rollback", "open_breaker", "scale_up", "page_oncall"])
    sub.add_parser("status", help="health, alerts and shop state")
    args = parser.parse_args()
    try:
        {"up": up, "break": break_service, "investigate": investigate, "approve": approve, "status": status,
         "demo": demo}[args.cmd](args)
    except urllib.error.URLError as exc:
        raise SystemExit(f"cannot reach the sandbox ({exc}); start it with: python sandbox/run.py up") from None


if __name__ == "__main__":
    main()
