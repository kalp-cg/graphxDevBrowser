#!/usr/bin/env bash
# The demo, from a clean slate, in one command: DevBrowser with its own SentinelGraph, on the 38-service sample company.
#   ./scripts/demo.sh
# The demo graph lives in .sentinel-demo/ (wiped on every run), so your own connected project in .sentinel-data/ is untouched.
# In the app: Overview > System map > pick a service > "Ship a bad deploy" > Investigate > Approve the rollback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "First run: creating the Python environment (a minute or two)..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install --quiet --upgrade pip
  "$ROOT/backend/.venv/bin/pip" install --quiet -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/DevBrowser/node_modules" ]; then
  (cd "$ROOT/DevBrowser" && npm ci)
fi

# A SentinelGraph left running on :8100 would be reused with whatever graph it has: stop it.
pkill -f "uvicorn sentinel.api.main:app.*--port 8100" 2>/dev/null || true
rm -rf "$ROOT/.sentinel-demo"

cd "$ROOT/DevBrowser"
export LOCAL_GRAPH_DIR="$ROOT/.sentinel-demo"
unset ELECTRON_RUN_AS_NODE
exec npm run dev
