"""Actions: the agent can only *propose*; a human approves; the backend executes.

propose_action  -> (:Action {status: 'pending'})-[:TARGETS]->(Service | Deployment)   [MCP tool]
execute_action  -> graph writes + recovery + incident settlement                         [backend only]
"""
import json
import logging
import os
import subprocess
import threading
import urllib.request
import uuid
from abc import ABC, abstractmethod

from ..db import Graph, attrs, link, upsert
from ..schema import vertex_type
from .common import check_services, graph_or_default, now_ms, result
from .health import recompute_health
from .incidents import RECENT_DEPLOY_MS, incident_for_run, settle_incidents
from .read import service_context
from .rootcause import deployments

log = logging.getLogger(__name__)

KINDS = {
    "rollback": "Roll back the most recent deployment of the service",
    "open_breaker": "Open the circuit breakers on every call into the service so callers fall back",
    "scale_up": "Add capacity to the service (and close its breakers again)",
    "page_oncall": "Page the on-call engineer of the team that owns the service",
}
RISKS = {"low", "medium", "high"}
STATUSES = {"pending", "executing", "executed", "rejected", "failed", "expired", "approved"}

# Status changes are check-then-set; this lock makes them atomic within the API process, so two simultaneous
# approvals (two tabs, a double click) can't both run an action.
_claim = threading.Lock()


def _action_view(a: dict) -> dict:
    keys = ("uid", "kind", "status", "target", "target_uid", "reason", "risk", "created_at", "executed_at",
            "approved_by", "outcome", "run_id")
    # `target` is a reserved word in GSQL, so it is stored as target_name. Unset attributes read back as "" / 0.
    a = {**a, "target": a.get("target_name")}
    return {k: a.get(k) if a.get(k) not in ("", 0) else None for k in keys}


def get_action(uid: str, graph: Graph | None = None) -> dict | None:
    g = graph_or_default(graph)
    found = attrs(g, "Action", uid)
    return _action_view(found) if found else None


def list_actions(status: str | None = None, graph: Graph | None = None) -> list[dict]:
    g = graph_or_default(graph)
    where = f'status="{status}"' if status in STATUSES else ""
    if status and not where:
        return []
    found = [{"uid": v["v_id"], **v["attributes"]} for v in g.getVertices("Action", where=where)]
    found.sort(key=lambda a: -a["created_at"])
    return [_action_view(a) for a in found[:50]]


def _current_on_call(g: Graph, service: str) -> dict | None:
    ctx = service_context(g, service)
    if not ctx["on_call"]:
        return None
    return {**ctx["on_call"][0], "channel": ctx["team"].get("slack_channel")}


# Writes are REST++ upserts (no query needed); this is what the UI shows for them.
PROPOSE_UPSERT = (
    "POST /restpp/graph/{graph}  upsert Action {uid, kind, status: 'pending', target_name, target_uid, reason, "
    "risk, created_at, run_id};  upsert edges (Action)-[TARGETS]->(Service|Deployment), "
    "(Incident {run_id})-[RESOLVED_BY]->(Action)"
)

def propose_action(kind: str, target: str, reason: str, risk: str = "medium", run_id: str | None = None,
                   graph: Graph | None = None) -> dict:
    """Create a pending Action for a human to approve. Changes nothing else in the graph."""
    g = graph_or_default(graph)
    if kind not in KINDS:
        return {"error": "bad_kind", "message": f"kind must be one of {sorted(KINDS)}"}
    if err := check_services(g, [target]):
        return err
    risk = str(risk).lower() if str(risk).lower() in RISKS else "medium"

    target_uid = f"svc:{target}"
    note = None
    if kind == "rollback":
        dep = [d for d in deployments(g, [target]) if d["status"] == "live"][:1]
        if not dep or dep[0]["at"] < now_ms() - RECENT_DEPLOY_MS:
            # Guard against blaming a change that didn't happen: nothing recent to roll back.
            return {"error": "no_recent_deploy",
                    "message": f"{target} has no deployment in the last 2 hours; a rollback would not help. "
                               "Consider open_breaker or scale_up instead."}
        target_uid = dep[0]["uid"]
        note = f"roll back {dep[0]['version']}"
    elif kind == "page_oncall":
        oncall = _current_on_call(g, target)
        note = f"page {oncall['name']}" if oncall else "page the owning team"

    existing = g.getVertices("Action", where=f'kind="{kind}",target_name="{target}",status="pending"')
    if existing:
        a = _action_view({"uid": existing[0]["v_id"], **existing[0]["attributes"]})
        return result({"action": a, "note": "already proposed"},
                      "GET /restpp/graph/{graph}/vertices/Action?filter=kind,target_name,status='pending'",
                      [a["uid"], a["target_uid"]])

    uid = f"act:{uuid.uuid4().hex[:10]}"
    upsert(g, "Action", [{"uid": uid, "kind": kind, "status": "pending", "target_name": target,
                          "target_uid": target_uid, "reason": str(reason)[:500], "risk": risk, "created_at": now_ms(),
                          "run_id": run_id or "", "summary": note or ""}])
    link(g, "Action", "TARGETS", vertex_type(target_uid), [(uid, target_uid)])
    inc = incident_for_run(g, run_id or "")
    if inc:
        link(g, "Incident", "RESOLVED_BY", "Action", [(inc["uid"], uid)])
    a = get_action(uid, g)
    return result({"action": a, "description": KINDS[kind], "note": note,
                   "next": "A human must approve this action before anything changes."},
                  PROPOSE_UPSERT, [uid, target_uid])


def _set_status(g: Graph, uid: str, expect: str, **changes) -> dict | None:
    """Move an action out of `expect` status atomically (within this process); None if it wasn't in it."""
    with _claim:
        found = attrs(g, "Action", uid)
        if not found or found["status"] != expect:
            return None
        upsert(g, "Action", [{"uid": uid, **changes}])
        return _action_view({**found, **changes})


def reject_action(uid: str, by: str = "human", graph: Graph | None = None) -> dict | None:
    g = graph_or_default(graph)
    return _set_status(g, uid, "pending", status="rejected", approved_by=by, executed_at=now_ms())


def _send_pagerduty(message: str, service: str) -> bool:
    """Optional PagerDuty Events v2 page if PAGERDUTY_ROUTING_KEY is set."""
    key = os.getenv("PAGERDUTY_ROUTING_KEY")
    if not key:
        return False
    body = json.dumps({
        "routing_key": key,
        "event_action": "trigger",
        "payload": {
            "summary": message,
            "severity": "error",
            "source": "sentinelgraph",
            "component": service,
        },
    }).encode()
    try:
        req = urllib.request.Request(
            "https://events.pagerduty.com/v2/enqueue",
            body,
            {"Content-Type": "application/json", "User-Agent": "SentinelGraph"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in (200, 202)
    except Exception as exc:  # noqa: BLE001
        log.warning("pagerduty notification failed: %s", exc)
        return False


def _send_webhook(text: str) -> bool:
    """Optional real page: POST to a Discord/Slack-compatible webhook if PAGER_WEBHOOK_URL is set."""
    url = os.getenv("PAGER_WEBHOOK_URL")
    if not url:
        return False
    body = json.dumps({"content": text, "text": text}).encode()
    try:
        req = urllib.request.Request(url, body, {"Content-Type": "application/json", "User-Agent": "SentinelGraph"})
        urllib.request.urlopen(req, timeout=5).close()
        return True
    except Exception as exc:  # noqa: BLE001 - paging must never break the action
        log.warning("webhook failed: %s", exc)
        return False


def _page(g: Graph, a: dict) -> tuple[list[str], str]:
    p = _current_on_call(g, a["target"])
    if not p:
        return [], "no on-call engineer found"
    message = f"[SentinelGraph] {a['target']}: {a.get('reason') or 'incident in progress'}"
    page_uid = f"page:{uuid.uuid4().hex[:10]}"
    upsert(g, "Page", [{"uid": page_uid, "at": now_ms(), "message": message, "channel": p["channel"] or ""}])
    link(g, "Page", "NOTIFIED", "Person", [(page_uid, p["uid"])])
    inc = incident_for_run(g, a.get("run_id") or "")
    if inc:
        link(g, "Incident", "PAGED", "Page", [(inc["uid"], page_uid)])
    delivered_webhook = _send_webhook(f"🚨 Paging {p['name']} ({p['channel']}): {message}")
    delivered_pd = _send_pagerduty(message, a["target"])
    channels: list[str] = []
    if delivered_webhook:
        channels.append("webhook")
    if delivered_pd:
        channels.append("pagerduty")
    delivery_note = f" + {' + '.join(channels)}" if channels else ""
    return [page_uid, p["uid"]], f"paged {p['name']} via {p['channel']}{delivery_note}"


class ActionExecutor(ABC):
    """Adapter interface for executing remediation actions on real infrastructure."""

    @abstractmethod
    def rollback(self, service: str, deployment_uid: str, live: bool = False) -> tuple[bool, str]:
        """Roll back service deployment. Returns (success, log_detail)."""

    @abstractmethod
    def scale_up(self, service: str, live: bool = False) -> tuple[bool, str]:
        """Scale up service capacity. Returns (success, log_detail)."""

    @abstractmethod
    def open_breaker(self, service: str, live: bool = False) -> tuple[bool, str]:
        """Open circuit breakers into service. Returns (success, log_detail)."""


class DryRunExecutor(ActionExecutor):
    """Default executor that simulates and logs commands without touching infrastructure."""

    def rollback(self, service: str, deployment_uid: str, live: bool = False) -> tuple[bool, str]:
        version = deployment_uid.split(":")[-1]
        return True, f"dry-run: rollback {service} to previous version (replaced {version})"

    def scale_up(self, service: str, live: bool = False) -> tuple[bool, str]:
        return True, f"dry-run: scale up {service} replicas"

    def open_breaker(self, service: str, live: bool = False) -> tuple[bool, str]:
        return True, f"dry-run: isolate {service} with circuit breakers"


class KubernetesExecutor(ActionExecutor):
    """Kubectl adapter for Kubernetes clusters (e.g. k3s running OpenTelemetry Demo)."""

    def __init__(self, kubectl_bin: str | None = None, namespace: str | None = None) -> None:
        self.kubectl = kubectl_bin or os.getenv("KUBECTL_BIN", "kubectl")
        self.namespace = namespace or os.getenv("K8S_NAMESPACE", "")

    def _cmd(self, args: list[str]) -> list[str]:
        cmd = [self.kubectl] + args
        if self.namespace:
            cmd.extend(["-n", self.namespace])
        return cmd

    def rollback(self, service: str, deployment_uid: str, live: bool = False) -> tuple[bool, str]:
        cmd = self._cmd(["rollout", "undo", f"deployment/{service}"])
        if not live:
            return True, f"dry-run: {' '.join(cmd)}"
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            detail = (res.stdout or res.stderr or "").strip()
            return res.returncode == 0, f"kubectl: {detail or f'exit {res.returncode}'}"
        except Exception as exc:  # noqa: BLE001
            log.warning("kubectl rollback failed: %s", exc)
            return False, f"kubectl error: {exc}"

    def scale_up(self, service: str, live: bool = False) -> tuple[bool, str]:
        cmd = self._cmd(["scale", f"deployment/{service}", "--replicas=3"])
        if not live:
            return True, f"dry-run: {' '.join(cmd)}"
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            detail = (res.stdout or res.stderr or "").strip()
            return res.returncode == 0, f"kubectl: {detail or f'exit {res.returncode}'}"
        except Exception as exc:  # noqa: BLE001
            log.warning("kubectl scale failed: %s", exc)
            return False, f"kubectl error: {exc}"

    def open_breaker(self, service: str, live: bool = False) -> tuple[bool, str]:
        cmd = self._cmd(["annotate", f"service/{service}", "sentinelgraph/breaker=open", "--overwrite"])
        if not live:
            return True, f"dry-run: {' '.join(cmd)}"
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            detail = (res.stdout or res.stderr or "").strip()
            return res.returncode == 0, f"kubectl: {detail or f'exit {res.returncode}'}"
        except Exception as exc:  # noqa: BLE001
            return False, f"kubectl error: {exc}"


class GitHubExecutor(ActionExecutor):
    """GitHub Actions adapter: triggers release/rollback workflow dispatch."""

    def __init__(self, repo: str | None = None, token: str | None = None, workflow: str | None = None) -> None:
        self.repo = repo or os.getenv("GITHUB_REPO", "")
        self.token = token or os.getenv("GITHUB_TOKEN", "")
        self.workflow = workflow or os.getenv("GITHUB_WORKFLOW", "deploy.yml")

    def rollback(self, service: str, deployment_uid: str, live: bool = False) -> tuple[bool, str]:
        desc = f"gh workflow run {self.workflow} -R {self.repo or 'OWNER/REPO'} -f service={service} -f action=rollback"
        if not live:
            return True, f"dry-run: {desc}"
        if not self.repo or not self.token:
            return False, "missing GITHUB_REPO or GITHUB_TOKEN"
        url = f"https://api.github.com/repos/{self.repo}/actions/workflows/{self.workflow}/dispatches"
        body = json.dumps({
            "ref": "main",
            "inputs": {"service": service, "action": "rollback", "deployment": deployment_uid},
        }).encode()
        try:
            req = urllib.request.Request(
                url, body,
                {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {self.token}",
                 "User-Agent": "SentinelGraph"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status in (200, 204), f"github workflow dispatched (HTTP {r.status})"
        except Exception as exc:  # noqa: BLE001
            return False, f"github dispatch failed: {exc}"

    def scale_up(self, service: str, live: bool = False) -> tuple[bool, str]:
        return True, f"github: scale_up not configured for {service}"

    def open_breaker(self, service: str, live: bool = False) -> tuple[bool, str]:
        return True, f"github: open_breaker not configured for {service}"


def get_executor() -> ActionExecutor:
    adapter = os.getenv("ACTION_ADAPTER", "dry_run").lower()
    if adapter in ("kubernetes", "k8s"):
        return KubernetesExecutor()
    if adapter in ("github", "gh"):
        return GitHubExecutor()
    return DryRunExecutor()


def execute_action(uid: str, approved_by: str = "human", graph: Graph | None = None) -> dict:
    """Run an approved action against the graph, then let recovery and incident settlement follow."""
    g = graph_or_default(graph)
    a = _set_status(g, uid, "pending", status="executing")
    if not a:
        found = get_action(uid, g)
        if not found:
            return {"error": "not_found", "message": f"no action {uid}"}
        return {"error": "not_pending", "message": f"action {uid} is {found['status']}"}
    try:
        return _run_action(g, a, uid, approved_by)
    except Exception as exc:
        # Never leave an action stuck in 'executing'.
        upsert(g, "Action", [{"uid": uid, "status": "failed", "outcome": f"failed: {exc}"[:300],
                              "executed_at": now_ms()}])
        raise


def _run_action(g: Graph, a: dict, uid: str, approved_by: str) -> dict:
    changed: list[str] = []
    edges: list[str] = []
    kind, target = a["kind"], a["target"]
    svc = f"svc:{target}"
    callers = g.getEdges("Service", svc, "reverse_DEPENDS_ON")

    executor = get_executor()
    live = os.getenv("ACTIONS_MODE", "dry_run").lower() == "live"
    exec_ok = True
    exec_detail = ""

    if kind == "rollback":
        upsert(g, "Deployment", [{"uid": a["target_uid"], "status": "rolled_back"}])
        upsert(g, "Service", [{"uid": svc, "status": "healthy", "root_fault": False}])
        changed += [a["target_uid"], svc]
        exec_ok, exec_detail = executor.rollback(target, a["target_uid"], live=live)
        outcome = f"rolled back {a['target_uid'].split(':')[-1]} on {target}"
    elif kind == "open_breaker":
        link(g, "Service", "DEPENDS_ON", "Service", [(e["to_id"], svc, {"breaker": "open"}) for e in callers])
        edges += [e["attributes"]["uid"] for e in callers]
        exec_ok, exec_detail = executor.open_breaker(target, live=live)
        outcome = f"opened {len(callers)} circuit breakers into {target}"
    elif kind == "scale_up":
        upsert(g, "Service", [{"uid": svc, "status": "healthy", "root_fault": False}])
        closed = [e for e in callers if e["attributes"]["breaker"] == "open"]
        link(g, "Service", "DEPENDS_ON", "Service", [(e["to_id"], svc, {"breaker": "closed"}) for e in closed])
        edges += [e["attributes"]["uid"] for e in closed]
        changed.append(f"svc:{target}")
        exec_ok, exec_detail = executor.scale_up(target, live=live)
        outcome = f"scaled up {target}" + (f" and closed {len(closed)} breakers" if closed else "")
    else:  # page_oncall
        uids, outcome = _page(g, a)
        changed += uids

    if exec_detail:
        outcome = f"{outcome} [{exec_detail}]"
    if live and not exec_ok:
        outcome = f"{outcome} [EXECUTION_WARNING: real adapter failed]"

    health = recompute_health(g)
    upsert(g, "Action", [{"uid": uid, "status": "executed", "approved_by": approved_by, "executed_at": now_ms(),
                          "outcome": outcome}])
    resolved_incidents = settle_incidents(g)
    return {
        "action": get_action(uid, g),
        "outcome": outcome,
        "node_uids": list(dict.fromkeys(changed + health["recovered"] + health["resolved_alerts"])),
        "edge_uids": edges,
        "recovered": health["recovered"],
        "resolved_alerts": health["resolved_alerts"],
        "resolved_incidents": resolved_incidents,
    }

