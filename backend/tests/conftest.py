import os

os.environ.setdefault("AUTOPILOT_DELAY_S", "0")  # before sentinel.config is imported
os.environ["ADMIN_TOKEN"] = "test-admin-token"

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
