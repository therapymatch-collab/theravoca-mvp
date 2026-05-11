#!/bin/bash
# Encoding sanity check -- catches double-encoded UTF-8 (Latin-1 mojibake).
# Run after every commit: ./scripts/check_encoding.sh
# Exit 0 = clean, exit 1 = corruption found.
#
# Strategy: look for SIGNATURE substrings that only appear when UTF-8 was
# mis-decoded as Latin-1 and re-encoded. Plain valid UTF-8 (e.g. `·`, `*`,
# `--`, smart quotes) does NOT match these patterns -- so user-facing
# strings that legitimately use unicode are not false-flagged.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Known mojibake signatures (each is the visual artifact of a specific
# corruption). Tested empirically against the real corruption that was
# in matching.py / helpers.py before cleanup.
PATTERN='ââ|â€™|â€œ|â€¢|â€¦|â€"|â€"|Ã©|Ã¨|Ã |Ã§|Ã¢|Ã®|Ã´|Â§|Â¶|Â°|Â±|Ã„|Ãœ|Ãÿ'

hits=$(grep -rn -E "$PATTERN" \
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
