"""FastAPI app: REST for control, one WebSocket that streams every event to every viewer.

Run: uvicorn sentinel.api.main:app --port 8000
"""
import asyncio
import hmac
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..agent.llm import available_providers, make_llm
from ..agent.loop import investigate
from ..agent.mcp_client import GraphToolbox
from ..config import settings
from ..db import get_graph
from ..ingest.alerts import ingest_alertmanager
from ..ingest.browser import to_otlp as browser_to_otlp
from ..ingest.otel import ingest_traces, record_change
from ..seed.generator import refresh_on_call
from ..seed.scenarios import SCENARIOS, inject_chaos, inject_scenario, reset, service_count
from ..tools import actions, read
from ..tools.common import now_ms
from .graph_view import graph_snapshot, incidents_view

log = logging.getLogger("sentinel.api")


class Hub:
    """Fan-out of events to every connected WebSocket, plus the current run's history for late joiners."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.history: list[dict] = []

    async def broadcast(self, event: dict) -> None:
        if event.get("run_id") and event["type"] != "graph_update":
            if event["type"] == "run_started":
                self.history = []
            self.history.append(event)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:  # noqa: BLE001 - a closed socket must not break the others
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


class RunManager:
    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self.toolbox: GraphToolbox | None = None
        self.task: asyncio.Task | None = None
        self.run_id: str | None = None

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()

    async def start(self, question: str, provider: str | None) -> str:
        if self.busy:
            raise HTTPException(409, "an investigation is already running")
        try:
            llm = make_llm(provider)
        except RuntimeError as exc:
            raise HTTPException(400, str(exc)) from exc
        if self.toolbox is None:
            self.toolbox = await GraphToolbox().start()
        self.run_id = uuid.uuid4().hex[:12]
        self.task = asyncio.create_task(self._run(question, llm, self.run_id))
        return self.run_id

    async def _run(self, question: str, llm: Any, run_id: str) -> None:
        try:
            assert self.toolbox is not None
            await investigate(question, self.hub.broadcast, self.toolbox, llm, run_id=run_id)
        except Exception as exc:  # noqa: BLE001 - report every failure to the UI as the single terminal event
            log.exception("run failed")
            await self.hub.broadcast({"type": "error", "run_id": run_id, "message": str(exc)[:500]})
            # A broken MCP session is restarted on the next run.
            if self.toolbox:
                await self.toolbox.close()
            self.toolbox = None
        finally:
            await self.hub.broadcast({"type": "graph_update", "reason": "run_finished"})


hub = Hub()
runs = RunManager(hub)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        runs.toolbox = await GraphToolbox().start()
    except Exception:  # noqa: BLE001 - the API still serves; the toolbox is retried on first run
        log.exception("could not start the MCP toolbox")
    try:
        await asyncio.to_thread(refresh_on_call, get_graph())
    except Exception:  # noqa: BLE001 - an empty or unreachable graph must not stop the API from starting
        log.warning("could not refresh on-call windows", exc_info=True)
    yield
    if runs.toolbox:
        await runs.toolbox.close()


app = FastAPI(title="SentinelGraph", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"],
                   allow_headers=["*"])


def require_admin(x_admin_token: str | None = Header(default=None),
                  authorization: str | None = Header(default=None)) -> None:
    """Gate for every route that writes or spends LLM credits. Fails closed when ADMIN_TOKEN is unset."""
    expected = os.getenv("ADMIN_TOKEN", "")  # read per request so it can be rotated without code changes
    bearer = (
        authorization.removeprefix("Bearer ").strip()
        if (authorization and authorization.startswith("Bearer "))
        else ""
    )
    token = x_admin_token or bearer
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, "missing or invalid X-Admin-Token")


admin = [Depends(require_admin)]


class RunRequest(BaseModel):
    question: str = "Alerts are firing. Investigate, find the root cause and fix it."
    provider: str | None = None


@app.get("/api/health")
async def health() -> dict:
    try:
        n = await asyncio.to_thread(lambda: service_count(get_graph()))
        db = {"ok": True, "services": n}
    except Exception as exc:  # noqa: BLE001
        db = {"ok": False, "error": str(exc)[:200]}
    try:
        llm = make_llm().name
    except RuntimeError as exc:
        llm = f"unavailable: {exc}"
    providers = await asyncio.to_thread(available_providers)
    return {"tigergraph": db, "graph": settings.tg_graph, "llm": llm, "providers": providers,
            "commit": (os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or "")[:7],
            "tools": runs.toolbox.names if runs.toolbox else [], "running": runs.busy}


@app.get("/api/graph")
async def graph() -> dict:
    return await asyncio.to_thread(graph_snapshot)


@app.get("/api/incidents")
async def incidents() -> list[dict]:
    return await asyncio.to_thread(incidents_view)


@app.get("/api/scenarios")
async def scenarios() -> list[dict]:
    return [{"name": k, "title": v["title"], "alerts": [a[0] for a in v["alerts"]]} for k, v in SCENARIOS.items()]


@app.post("/api/scenarios/{name}", dependencies=admin)
async def start_scenario(name: str) -> dict:
    if name not in SCENARIOS:
        raise HTTPException(404, f"unknown scenario {name}")
    if runs.busy:
        raise HTTPException(409, "wait for the current investigation to finish")
    info = await asyncio.to_thread(inject_scenario, name)
    hub.history = []
    await hub.broadcast({"type": "scenario_started", **info})
    await hub.broadcast({"type": "graph_update", "reason": "scenario"})
    return info


@app.post("/api/chaos/{service}", dependencies=admin)
async def chaos(service: str, mode: str = "down", deploy: bool = False) -> dict:
    """Break any service (optionally with a bad deploy). Unscripted: the agent must work it out."""
    if runs.busy:
        raise HTTPException(409, "wait for the current investigation to finish")
    try:
        info = await asyncio.to_thread(inject_chaos, service, mode, deploy)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    hub.history = []
    await hub.broadcast({"type": "scenario_started", **info})
    await hub.broadcast({"type": "graph_update", "reason": "chaos"})
    return info


@app.post("/api/reset", dependencies=admin)
async def reset_graph(keep_memory: bool = True) -> dict:
    if runs.busy:
        raise HTTPException(409, "wait for the current investigation to finish")
    await asyncio.to_thread(reset, None, keep_memory)
    hub.history = []
    await hub.broadcast({"type": "graph_update", "reason": "reset"})
    return {"ok": True, "keep_memory": keep_memory}


@app.post("/v1/traces", dependencies=admin)
async def otlp_traces(payload: dict[str, Any], component: str = "service") -> dict:
    """OTLP/HTTP traces (JSON encoding), e.g. from an OpenTelemetry Collector `otlphttp` exporter with
    `encoding: json` and the X-Admin-Token header. component=module for a monolith (spans need code.namespace)."""
    kind = "module" if component == "module" else "service"
    out = await asyncio.to_thread(ingest_traces, get_graph(), payload, kind)
    await hub.broadcast({"type": "graph_update", "reason": "traces"})
    return out


@app.post("/api/browser-traffic", dependencies=admin)
async def browser_traffic(records: list[dict[str, Any]]) -> dict:
    """Requests captured by DevBrowser ({pageUrl, url, method, statusCode, mimeType, startTime, endTime}):
    page origin -> API host become dependencies, 5xx become failures of that host."""
    out = await asyncio.to_thread(ingest_traces, get_graph(), browser_to_otlp(records))
    await hub.broadcast({"type": "graph_update", "reason": "browser"})
    return out


@app.post("/api/alerts/alertmanager", dependencies=admin)
async def alertmanager_webhook(payload: dict[str, Any]) -> dict:
    """Prometheus Alertmanager webhook: creates firing/resolved Alert vertices and links to Service."""
    out = await asyncio.to_thread(ingest_alertmanager, get_graph(), payload)
    await hub.broadcast({"type": "graph_update", "reason": "alertmanager"})
    return out


@app.get("/api/services/{name}/blast-radius")
async def service_blast_radius(name: str, depth: int = 6) -> dict:
    out = await asyncio.to_thread(read.blast_radius, name, depth)
    if "error" in out:
        raise HTTPException(404, out["message"])
    return out


@app.get("/api/services/{name}/dependencies")
async def service_dependencies(name: str, depth: int = 3) -> dict:
    out = await asyncio.to_thread(read.trace_dependencies, name, depth)
    if "error" in out:
        raise HTTPException(404, out["message"])
    return out


class Change(BaseModel):
    service: str
    version: str
    author: str
    message: str
    sha: str
    at: int | None = None
    files: list[str] = []


@app.post("/api/changes", dependencies=admin)
async def change(c: Change) -> dict:
    """A deploy marker from CI/CD (or a flag change): Deployment -> Commit -> Person, deployed to the service."""
    uid = await asyncio.to_thread(record_change, get_graph(), c.service, c.version, c.at or now_ms(), c.author,
                                  c.message, c.sha, c.files)
    await hub.broadcast({"type": "graph_update", "reason": "change"})
    return {"deployment": uid}


@app.post("/api/runs", dependencies=admin)
async def start_run(req: RunRequest) -> dict:
    run_id = await runs.start(req.question, req.provider)
    return {"run_id": run_id}


@app.get("/api/actions")
async def list_actions(status: str | None = None) -> list[dict]:
    return await asyncio.to_thread(actions.list_actions, status)


@app.post("/api/actions/{uid}/approve", dependencies=admin)
async def approve(uid: str) -> dict:
    out = await asyncio.to_thread(actions.execute_action, uid, "human")
    if "error" in out:
        raise HTTPException(409 if out["error"] == "not_pending" else 404, out["message"])
    await hub.broadcast({"type": "action_executed", **out})
    await hub.broadcast({"type": "graph_update", "reason": "action"})
    return out


@app.post("/api/actions/{uid}/reject", dependencies=admin)
async def reject(uid: str) -> dict:
    out = await asyncio.to_thread(actions.reject_action, uid, "human")
    if not out:
        raise HTTPException(409, "action is not pending")
    await hub.broadcast({"type": "action_rejected", "action": out})
    return out


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await socket.accept()
    hub.clients.add(socket)
    await socket.send_json({"type": "hello", "history": hub.history, "running": runs.busy})
    try:
        while True:
            await socket.receive_text()  # keepalive pings from the client
    except WebSocketDisconnect:
        hub.clients.discard(socket)
