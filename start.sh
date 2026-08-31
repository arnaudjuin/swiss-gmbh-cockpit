#!/bin/bash
# Single-command launcher.
# Loads .env if present (so you can override ADMIN_PASSWORD / PORT / etc. there)
# and starts the app via the project's venv.
set -e
cd "$(dirname "$0")"
[ -f .env ] && set -a && source .env && set +a
exec .venv/bin/python app.py
