#!/bin/sh
# Wispbyte long-lived runtime startup (production build only, never vite dev).
# Uses the production Nitro node-server output; environment comes from the
# Wispbyte process environment, or from .env when present. Never prints secrets.
cd "$(dirname "$0")/.." || exit 1

if [ ! -f ".output/server/index.mjs" ]; then
  echo "ERROR: production build not found (.output/server/index.mjs). Run: npm run build"
  exit 1
fi

if [ -f ".env" ]; then
  exec node --env-file=.env .output/server/index.mjs
else
  exec node .output/server/index.mjs
fi
