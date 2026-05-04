#!/bin/bash
# Encoding sanity check -- catches double-encoded UTF-8 (Latin-1 mojibake).
# Run after every commit: ./scripts/check_encoding.sh
# Exit 0 = clean, exit 1 = corruption found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

hits=$(grep -rn -P '\xc3|\xc2' \
  "$REPO_ROOT/backend/" \
  "$REPO_ROOT/frontend/src/" \
  --include='*.py' --include='*.jsx' --include='*.js' \
  2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "FAIL: Encoding corruption found."
  echo "$hits"
  exit 1
else
  echo "OK: No encoding corruption detected."
  exit 0
fi
