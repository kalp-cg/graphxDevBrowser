"""What "normal" looks like for each service, learned while it was healthy.

A slow service is only slow compared with itself: a 4 s checkout is normal, a 4 s currency lookup is not. The OTLP ingest keeps, per
component, the p90 span duration of its recent healthy batches and compares the next batch with it. Stored as a small JSON file next to
the workspace (one per graph), so it works the same with TigerGraph and survives a restart.
"""
import json
import os
import statistics
import threading
from pathlib import Path

from .config import settings

KEEP = 30          # healthy batches remembered per component
MIN_BATCHES = 3    # before that, we do not know what normal is, so nothing is called slow
_lock = threading.Lock()


def _path(graph: str) -> Path:
    return Path(settings.local_graph_dir) / f"baselines-{graph}.json"


def load(graph: str) -> dict[str, list[float]]:
    try:
        return json.loads(_path(graph).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save(graph: str, data: dict[str, list[float]]) -> None:
    p = _path(graph)
    with _lock:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            os.replace(tmp, p)
        except OSError:  # a read-only deployment keeps working, it just forgets on restart
            pass


def scale(history: list[float]) -> tuple[float, float]:
    """(typical value, how much it normally wobbles), robust to the odd outlier."""
    med = statistics.median(history)
    mad = statistics.median(abs(x - med) for x in history) * 1.4826
    return med, max(mad, 0.1 * abs(med), 1e-6)


def z(value: float, history: list[float]) -> float:
    """How many normal wobbles `value` is above what is typical (0 when it is not above)."""
    med, spread = scale(history)
    return max(0.0, (value - med) / spread)


def is_slow(value: float, history: list[float], z: float, ratio: float) -> bool:
    if len(history) < MIN_BATCHES:
        return False
    med, spread = scale(history)
    return value >= ratio * med and (value - med) / spread >= z
