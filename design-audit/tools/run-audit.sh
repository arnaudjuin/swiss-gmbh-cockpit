#!/bin/bash
# Regenerate the design-audit screenshot bundle — one command, any session.
#
#   ./run-audit.sh              # all shots
#   ./run-audit.sh --only 16,17 # just the bank shots
#
# Starts its own uvicorn on :8399 with a known password (uses the real
# invoices.db read-only-ish — captures reflect real data), kills it after.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
PORT=8399
PASSWORD=design-audit

command -v node >/dev/null || { echo "node required"; exit 1; }
[ -d node_modules/playwright ] || npm install --no-audit --no-fund

# Start the app if nothing is on the port
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "Starting app on :$PORT …"
  ( cd "$ROOT" && ADMIN_PASSWORD=$PASSWORD .venv/bin/python -m uvicorn app:app --port $PORT >/tmp/design-audit-server.log 2>&1 ) &
  SERVER_PID=$!
  trap '[ -n "${SERVER_PID:-}" ] && kill $SERVER_PID 2>/dev/null || true' EXIT
  for i in $(seq 1 20); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
    sleep 0.5
  done
fi

node design-screenshots.mjs --base "http://127.0.0.1:$PORT" --password "$PASSWORD" "$@"
echo "Done → $(cd ../screenshots && pwd)"
