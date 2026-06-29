#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://ai.sportslack.com/v4/assess}"

echo "Checking ${BASE_URL}/api/health"
curl -fsS "${BASE_URL}/api/health"
echo

echo "Checking ${BASE_URL}/"
curl -I -sS "${BASE_URL}/" | sed -n '1,12p'
