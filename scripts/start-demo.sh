#!/usr/bin/env bash
# One command for the demo: (re)starts the SentinelGraph API on :8100 (your .env graph) and the sandbox shop + API on :8200.
# Always kills the old processes first, so a stale API with old code can never be what you demo.
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "uvicorn sentinel.api.main:app" 2>/dev/null || true
pkill -f "sandbox/run.py" 2>/dev/null || true
pkill -f run_shop.py 2>/dev/null || true
sleep 2
mkdir -p .sentinel-logs
(cd backend && set -a && . ../.env && set +a && nohup .venv/bin/python -m uvicorn sentinel.api.main:app --port 8100 > ../.sentinel-logs/api-8100.log 2>&1 &)
nohup backend/.venv/bin/python sandbox/run.py up > .sentinel-logs/sandbox.log 2>&1 &
echo "waiting for the APIs..."
for i in $(seq 1 60); do
  a=$(curl -s -o /dev/null -w "%{http_code}" localhost:8100/api/health || true)
  b=$(curl -s -o /dev/null -w "%{http_code}" localhost:8200/api/health || true)
  c=$(curl -s -o /dev/null -w "%{http_code}" localhost:7499/__control || true)
  [ "$a" = 200 ] && [ "$b" = 200 ] && [ "$c" = 200 ] && break
  sleep 1
done
echo "API :8100 -> $a   sandbox API :8200 -> $b   shop control :7499 -> $c   (logs in .sentinel-logs/)"
echo "DevBrowser: cd DevBrowser && npm run dev     "
