"""The workspace: what SentinelGraph knows about the codebase behind the graph, beyond vertices and edges.

Its main job is identity. A browser sees `localhost:7004`, a trace says `checkout`, the codebase says
`services/checkout`. A codebase scan (ingest/codebase.py) records every address a service answers on, so
traffic captured by DevBrowser lands on the same `Service` vertex as the traces and the code.

Stored as a small JSON file next to the local graph (one per graph), so it works the same with TigerGraph.
"""
import json
import os
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .config import settings

_lock = threading.Lock()
LOOPBACK = ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")


def _path(graph: str) -> Path:
    return Path(settings.local_graph_dir) / f"workspace-{graph}.json"


def load(graph: str | None = None) -> dict[str, Any]:
    p = _path(graph or settings.tg_graph)
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"aliases": {}}


def save(data: dict[str, Any], graph: str | None = None) -> None:
    p = _path(graph or settings.tg_graph)
    with _lock:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True))
        os.replace(tmp, p)


def host_of(url: str) -> str:
    """`http://127.0.0.1:7004/x` -> `localhost:7004` (loopback spellings are one host)."""
    netloc = (urlsplit(url).netloc if "://" in url else url).lower().rsplit("@", 1)[-1]
    if netloc.startswith("["):
        inner, _, rest = netloc[1:].partition("]")
        host, port = f"[{inner}]", rest.lstrip(":")
    else:
        host, _, port = netloc.partition(":")
    if host in LOOPBACK:
        host = "localhost"
    return f"{host}:{port}" if port else host


def resolve(host_or_url: str, aliases: dict[str, str] | None = None) -> str | None:
    """The service a host (or URL) belongs to, if the workspace knows it."""
    aliases = load()["aliases"] if aliases is None else aliases
    return aliases.get(host_of(host_or_url))
