import os

os.environ.setdefault("AUTOPILOT_DELAY_S", "0")  # before sentinel.config is imported
# The whole suite runs hermetically on the embedded engine, in a throwaway directory.
import tempfile  # noqa: E402

os.environ["LOCAL_GRAPH_DIR"] = tempfile.mkdtemp(prefix="sentinel-test-")

import pytest  # noqa: E402

from sentinel.db import get_graph  # noqa: E402
from sentinel.schema import ensure_schema  # noqa: E402
from sentinel.seed.generator import wipe  # noqa: E402

TEST_GRAPH = "Sentinel_test"


@pytest.fixture(scope="session")
def graph():
    """A throwaway graph so tests never touch the demo graph."""
    g = get_graph(TEST_GRAPH)
    ensure_schema(g)
    yield g
    wipe(g)
