"""Autopilot: a deterministic policy that speaks the same interface as an LLM.

It runs the same investigation protocol through the same MCP tools, so its runs look exactly like an LLM
run in the UI. Uses: CI, demos without a model, and taking over mid-run when the model fails (rate limit,
outage). It is always labelled as autopilot, never presented as the model.
"""
import asyncio
import json
import uuid
from typing import Any

from .llm import LLMReply, ToolCall


def _history(messages: list[dict]) -> list[tuple[str, dict, dict]]:
    """(tool name, args, result) for every tool call so far, in order."""
    calls: dict[str, tuple[str, dict]] = {}
    out = []
    for m in messages:
        if m["role"] == "assistant":
            for c in m.get("tool_calls") or []:
                args = c["function"]["arguments"]
                calls[c["id"]] = (c["function"]["name"], json.loads(args) if isinstance(args, str) else args)
        elif m["role"] == "tool" and m.get("tool_call_id") in calls:
            name, args = calls[m["tool_call_id"]]
            try:
                res = json.loads(m["content"])
            except (json.JSONDecodeError, TypeError):
                res = {}
            out.append((name, args, res if isinstance(res, dict) else {}))
    return out


class Autopilot:
    name = "autopilot (deterministic, no LLM)"

    def __init__(self, delay_s: float = 0.0):
        # Optional pause per step so people watching the UI can follow along; 0 in tests and CLI.
        self.delay_s = delay_s

    async def chat(self, messages: list[dict], tools: list[dict]) -> LLMReply:
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        h = _history(messages)
        last = {name: res.get("result", res) for name, _args, res in h}
        done = set(last)

        def call(name: str, **args: Any) -> LLMReply:
            return LLMReply(tool_calls=[ToolCall(id=f"auto_{uuid.uuid4().hex[:8]}", name=name, args=args)])

        if "get_active_alerts" not in done:
            return call("get_active_alerts")
        alerts = last["get_active_alerts"] if isinstance(last["get_active_alerts"], list) else []
        services = sorted({a["service"] for a in alerts if isinstance(a, dict) and "service" in a})
        if not services:
            return LLMReply(content="**All clear.** No alerts are firing, so there is nothing to investigate.")

        if "find_common_cause" not in done:
            return call("find_common_cause", services=services)
        common_res = last.get("find_common_cause") or {}
        if not isinstance(common_res, dict):
            common_res = {}
        candidates = [c for c in (common_res.get("candidates") or []) if isinstance(c, dict)]
        if not candidates or candidates[0].get("likely_root_cause") is False:
            # Nothing they all share: several independent failures, or a healthy-looking shared dependency.
            if len(services) < 2:
                return LLMReply(content="No unhealthy dependency found for the alerting service; escalating to a human.")
            if "find_root_causes" not in done:
                return call("find_root_causes", services=services)
            roots_res = last.get("find_root_causes") or {}
            roots = [r["name"] for r in (roots_res.get("roots") or []) if isinstance(r, dict)] if isinstance(roots_res, dict) else []
            if not roots:
                return LLMReply(content="No shared dependency and no unhealthy service beneath the alerting ones; escalating to a human.")
            return self._independent(h, call, services, roots, last, roots_res)
        top = candidates[0]["name"]
        others = [n for n in (common_res.get("other_failures") or []) if isinstance(n, str)]
        if others:  # something else is also broken and the top candidate does not explain it
            return self._independent(h, call, services, [top, *others], last, {})

        if "recall_similar" not in done:
            return call("recall_similar", services=services)
        recall_res = last.get("recall_similar") or {}
        if not isinstance(recall_res, dict):
            recall_res = {}
        repeat = next((i for i in (recall_res.get("incidents") or [])
                       if isinstance(i, dict) and i.get("root_cause_service") == top), None)

        if "recent_changes" not in done:
            return call("recent_changes", services=[top], minutes=60)
        recent_res = last.get("recent_changes") or {}
        if not isinstance(recent_res, dict):
            recent_res = {}
        changes = [c for c in (recent_res.get("changes") or []) if isinstance(c, dict)]
        change = changes[0] if changes else None

        if not repeat:
            if "get_service_context" not in done:
                return call("get_service_context", service=top)
            if "blast_radius" not in done:
                return call("blast_radius", service=top)
            if "critical_services" not in done:
                return call("critical_services", top=5, service=top)

        if repeat:
            kinds = [k for k in repeat.get("fixes", []) if k != "rollback" or change]
            # Fresh evidence beats memory: a deploy just before the alerts is rolled back whatever fixed it last time.
            if change and "rollback" not in kinds:
                kinds.insert(0, "rollback")
        else:
            kinds = ["rollback"] if change else ["open_breaker", "scale_up"]
        if "page_oncall" not in kinds:
            kinds.append("page_oncall")
        proposed = {args.get("kind") for name, args, _ in h if name == "propose_action" and isinstance(args, dict)}
        why = (f"{change['version']} '{change['message']}' by {change['author']} deployed "
               f"{change['minutes_ago']} min before the alerts" if change
               else f"{top} is the deepest unhealthy dependency shared by {', '.join(services)}")
        for kind in kinds:
            if kind not in proposed:
                return call("propose_action", kind=kind, target_service=top, reason=why,
                            risk="low" if kind == "page_oncall" else "medium")

        summary = (f"{', '.join(services)} alerted because they all depend on {top}. " + why[0].upper() + why[1:] + ".")
        if "conclude_investigation" not in done:
            return call("conclude_investigation", root_cause_service=top, summary=summary,
                        similar_incident=repeat["id"] if repeat else "")
        return LLMReply(content=self._report(top, services, change, repeat, last, kinds))

    def _independent(self, h: list, call: Any, services: list[str], roots: list[str], last: dict, roots_res: dict) -> LLMReply:
        """Several separate failures: a fix per root, a page per root, one conclusion that names them all."""
        if "recent_changes" not in {n for n, _a, _r in h}:
            return call("recent_changes", services=roots, minutes=60)
        recent = last.get("recent_changes") or {}
        changes = {c.get("service"): c for c in (recent.get("changes") or []) if isinstance(c, dict)} if isinstance(recent, dict) else {}
        proposed = {(args.get("kind"), args.get("target_service")) for name, args, _ in h
                    if name == "propose_action" and isinstance(args, dict)}
        for root in roots:
            change = changes.get(root)
            for kind in (["rollback"] if change else ["open_breaker", "scale_up"]) + ["page_oncall"]:
                if (kind, root) not in proposed:
                    why = (f"{change['version']} '{change['message']}' by {change['author']} deployed "
                           f"{change['minutes_ago']} min before the alerts" if change
                           else f"{root} is an unhealthy service of its own, separate from the other failures")
                    return call("propose_action", kind=kind, target_service=root, reason=why,
                                risk="low" if kind == "page_oncall" else "medium")
        explained = {r["name"]: r.get("explains", []) for r in (roots_res.get("roots") or []) if isinstance(r, dict)}
        behind = lambda r: f" (behind {', '.join(explained[r])})" if explained.get(r) else ""  # noqa: E731
        summary = f"{len(roots)} separate failures: " + "; ".join(f"{r}{behind(r)}" for r in roots) + "."
        if "conclude_investigation" not in {n for n, _a, _r in h}:
            return call("conclude_investigation", root_cause_service=roots[0], summary=summary, similar_incident="")
        lines = "\n".join(
            f"- `{r}`" + (f": deployment **{changes[r]['version']}** \"{changes[r]['message']}\" by {changes[r]['author']}, "
                          f"{changes[r]['minutes_ago']} min before the alerts" if r in changes else ": unhealthy, no recent deployment")
            + (f" (behind {', '.join(f'`{s}`' for s in explained[r])})" if explained.get(r) else "") for r in roots)
        return LLMReply(content=(
            f"**Root causes**: {len(roots)} separate failures, not one.\n{lines}\n\n"
            f"**Evidence**: the alerting services ({', '.join(f'`{s}`' for s in services)}); each of these services is "
            f"unhealthy with nothing unhealthy beneath it, so one does not explain the others.\n\n"
            f"**Proposed actions**: a fix and a page for each of {', '.join(f'`{r}`' for r in roots)}, awaiting human approval.\n\n"
            f"**Memory**: stored as one incident naming the first failure; the others are in its summary."))

    @staticmethod
    def _report(top: str, services: list[str], change: dict | None, repeat: dict | None, last: dict,
                kinds: list[str]) -> str:
        cause = (f"`{top}`: deployment **{change['version']}** \"{change['message']}\" by {change['author']}, "
                 f"{change['minutes_ago']} min before the alerts (`{change['uid']}`)." if change
                 else f"`{top}` itself is unhealthy; there is no recent deployment on it.")
        evidence = (f"Alerts on {', '.join(f'`svc:{s}`' for s in services)} → `find_common_cause` → all of them "
                    f"depend on `svc:{top}`, the deepest unhealthy shared dependency.")
        blast = last.get("blast_radius") or {}
        if not isinstance(blast, dict):
            blast = {}
        raw_tier = blast.get("by_tier")
        by_tier: dict[str, Any] = raw_tier if isinstance(raw_tier, dict) else {}
        impact = (f"{blast.get('count')} upstream services at risk ({', '.join(f'{v} {k}' for k, v in by_tier.items())})."
                  if blast and blast.get("count") is not None else f"{len(services)} alerting services.")
        memory = (f"Repeat of **{repeat['id']}** ({repeat['title']}); last time it took {repeat['steps_taken']} steps."
                  if repeat else "No past incident with this root cause; this one is now stored as memory.")
        return (f"**Root cause**: {cause}\n\n**Evidence**: {evidence}\n\n**Impact**: {impact}\n\n"
                f"**Proposed actions**: {', '.join(kinds)} on `{top}`, awaiting human approval.\n\n"
                f"**Memory**: {memory}")
