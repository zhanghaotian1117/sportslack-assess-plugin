#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f "frontend/dist/index.html" ]; then
  echo "Missing frontend/dist/index.html"
  echo "Please build the frontend into frontend/dist before deploying."
  exit 1
fi

npm run check
npx wrangler deploy --keep-vars
