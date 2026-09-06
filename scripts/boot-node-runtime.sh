#!/bin/sh
# Phase 3.8-E.2 audit launcher (read-only audit tool, not app source).
# Boots the built nitro node-server with env loading so provider registry
# and DATABASE_URL are available, without modifying any app source.
# Usage: sh scripts/boot-node-runtime.sh <logfile> [port]
LOG="${1:-/tmp/e2-runtime.log}"
PORT_ARG="${2:-8902}"
export PORT="$PORT_ARG"
cd "$(dirname "$0")/.." || exit 1
if [ -f .env ]; then
  exec node --env-file=.env .output/server/index.mjs >"$LOG" 2>&1
else
  echo "NO_ENV_FILE" >"$LOG"
  exit 2
fi
