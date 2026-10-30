#!/usr/bin/env bash
# Runs the SentinelGraph server on this machine, on 127.0.0.1 only (it has no login, so it is never exposed).
#   ./scripts/sentinelgraph.sh            start on http://127.0.0.1:8100
#   PORT=8200 ./scripts/sentinelgraph.sh  another port
#   LLM_PROVIDER=ollama|gemini|openai     use a model instead of the built-in deterministic agent
# First run creates backend/.venv and installs the dependencies. The graph is kept in .sentinel-data/.
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -x .venv/bin/python ]; then
  echo "First run: creating the Python environment (a minute or two)..."
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
fi
export GRAPH_BACKEND="${GRAPH_BACKEND:-local}"
export LLM_PROVIDER="${LLM_PROVIDER:-autopilot}"
PORT="${PORT:-8100}"
echo "SentinelGraph on http://127.0.0.1:${PORT}   (graph: ${GRAPH_BACKEND}, agent: ${LLM_PROVIDER})"
echo "In DevBrowser: Settings > Integrations > SentinelGraph, then Connect codebase. Ctrl+C stops it."
exec .venv/bin/python -m uvicorn sentinel.api.main:app --host 127.0.0.1 --port "$PORT"
