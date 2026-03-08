#!/bin/bash
# FontMaker — Local Development Server
set -euo pipefail

NAME="Font Maker"
PORT="${PORT:-5173}"

echo ""
echo "  $NAME"
echo "  ─────────────────────────────"

command -v node >/dev/null 2>&1 || { echo "  ERR: node not found"; exit 1; }
[ -d node_modules ] || { echo "  Installing dependencies..."; npm ci; }

echo "  http://localhost:${PORT}"
echo "  ─────────────────────────────"
echo ""
npm run dev
