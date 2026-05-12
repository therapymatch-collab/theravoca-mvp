#!/usr/bin/env bash
# Post-deploy smoke test for staging.
#
# Usage:
#   bash scripts/smoke_test.sh [expected-commit-sha [timeout-seconds]]
#
# - With one arg, polls /api/version until the commit hash starts with that
#   prefix (or the timeout fires), then hits a few public endpoints to
#   confirm the server is healthy. Without args, just hits the endpoints
#   against whatever is currently live.
#
# - Default timeout is 600s (10 min) which covers Render's 3-5 min build
#   plus restart latency.
#
# Public endpoints chosen because they bypass STAGING_PASSWORD basic-auth:
# /api/version, /api/site-copy, /api/blog. (See backend/_start.py
# _PUBLIC_PREFIXES for the full list.)
#
# Note: --ssl-no-revoke is required when running from Windows curl with
# the Schannel backend, which can't always reach the cert revocation
# server. Connection still uses HTTPS, just skips the revocation check.

set -u

URL="${SMOKE_BASE_URL:-https://theravoca-production.onrender.com}"
EXPECTED="${1:-}"
TIMEOUT="${2:-600}"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

# Fail counter — script exits non-zero if any check fails.
fails=0

cache_bust() { echo "?_smoke=$(date +%s)"; }

# Wait for Render to deploy the expected commit ----------------------
if [ -n "$EXPECTED" ]; then
  echo "Waiting for /api/version to report commit $EXPECTED (timeout ${TIMEOUT}s)..."
  start=$(date +%s)
  while :; do
    body=$(curl --ssl-no-revoke -fsSL "$URL/api/version$(cache_bust)" 2>/dev/null || true)
    live=$(echo "$body" | grep -oE '"commit":"[a-f0-9]+"' | head -1 | sed 's/"commit":"//;s/"//')
    case "$live" in
      "$EXPECTED"*) green "  -> live commit: $live"; break ;;
      "")           yellow "  ... no version response yet" ;;
      *)            yellow "  ... still on $live" ;;
    esac
    now=$(date +%s)
    if [ $((now - start)) -ge "$TIMEOUT" ]; then
      red "TIMEOUT after ${TIMEOUT}s. Last seen commit: ${live:-none}"
      fails=$((fails + 1))
      break
    fi
    sleep 15
  done
fi

# Hit public endpoints and check they return non-error JSON ----------
check_endpoint() {
  local path="$1"; local label="$2"
  local code body
  body=$(curl --ssl-no-revoke -fsSL -w '\n__HTTP__=%{http_code}' "$URL$path$(cache_bust)" 2>/dev/null || true)
  code=$(echo "$body" | grep '^__HTTP__=' | cut -d= -f2)
  body=$(echo "$body" | grep -v '^__HTTP__=')
  if [ "$code" = "200" ] && [ -n "$body" ]; then
    green "OK   $label ($path)"
  else
    red   "FAIL $label ($path) -> http $code"
    fails=$((fails + 1))
  fi
}

echo
echo "Hitting public endpoints..."
check_endpoint "/api/version"    "version"
check_endpoint "/api/site-copy"  "site-copy"
check_endpoint "/api/blog"       "blog"

echo
if [ "$fails" -eq 0 ]; then
  green "Smoke test PASSED"
  exit 0
else
  red "Smoke test FAILED ($fails check(s))"
  exit 1
fi
