"""Browser traffic -> the dependency graph.

DevBrowser captures every request a page makes (over the Chrome DevTools Protocol). Each API call is a real
dependency: the web app at the page's origin calls the service at the request's host. The records become
OTLP spans (a CLIENT span in the web app, a SERVER span in the service) and go through the same ingest as
OpenTelemetry traces, so topology, health and alerts follow the same rules (otel.py).

A 5xx (or a request that never got a response) is a failure of the service; a 4xx is the caller's mistake and
is not counted. Passive capture is written as topology only (the API passes health=False): one developer
clicking around a staging page must never flip a service's health or page anyone. Failures become health
signals only when a developer attaches them to an investigation ("Investigate this failure"). Documents, scripts, styles, images and fonts are page assets, not service calls.

Hosts are resolved through the workspace aliases (workspace.py): after a codebase scan, a call to
`localhost:7004` is a call to `checkout`, the same vertex its traces and its code describe, and a page served by
a scanned web service is that service rather than a separate `web:<host>` app.
"""
from typing import Any
from urllib.parse import urlsplit

from ..workspace import resolve

ASSET_TYPES = ("text/html", "javascript", "text/css", "image/", "font/", "audio/", "video/")


def _host(url: str) -> str:
    return urlsplit(url).netloc


def is_api_call(r: dict[str, Any]) -> bool:
    mime = (r.get("mimeType") or "").lower()
    return urlsplit(r.get("url", "")).scheme in ("http", "https") and not any(t in mime for t in ASSET_TYPES)


def _attrs(values: dict[str, Any]) -> list[dict]:
    return [{"key": k, "value": {"stringValue": str(v)}} for k, v in values.items()]


def to_otlp(records: list[dict[str, Any]], aliases: dict[str, str] | None = None) -> dict[str, Any]:
    """Records ({pageUrl, url, method, statusCode?, startTime, endTime?} in epoch ms) -> OTLP/JSON."""
    aliases = aliases or {}
    spans: dict[str, list[dict]] = {}
    for n, r in enumerate(x for x in records if is_api_call(x) and x.get("pageUrl")):
        if not _host(r["url"]):
            continue
        page = resolve(r["pageUrl"], aliases) or f"web:{_host(r['pageUrl'])}"
        service = resolve(r["url"], aliases) or _host(r["url"])
        if page == service:
            continue  # a page calling its own backend is one component
        status = int(r.get("statusCode") or 0)
        failed = status == 0 or status >= 500
        start = int(r["startTime"]) * 1_000_000
        end = int(r.get("endTime") or r["startTime"]) * 1_000_000
        trace, client, server = f"{n:032x}", f"c{n:015x}", f"s{n:015x}"
        common = {"traceId": trace, "startTimeUnixNano": str(start), "endTimeUnixNano": str(end),
                  "status": {"code": 2 if failed else 0}}
        attrs = _attrs({"http.request.method": r.get("method", "GET"), "url.full": r["url"],
                        "http.response.status_code": status})
        spans.setdefault(page, []).append({**common, "spanId": client, "parentSpanId": "", "kind": 3,
                                           "name": f"{r.get('method', 'GET')} {service}", "attributes": attrs})
        spans.setdefault(service, []).append({**common, "spanId": server, "parentSpanId": client, "kind": 2,
                                              "name": f"{r.get('method', 'GET')} {urlsplit(r['url']).path}",
                                              "attributes": attrs})
    return {"resourceSpans": [
        {"resource": {"attributes": _attrs({"service.name": name})}, "scopeSpans": [{"spans": s}]}
        for name, s in spans.items()
    ]}
