#!/bin/bash
# Regression guard for the 2026-05-17 Turnstile-render-on-step-9 bug.
#
# Background: TherapistSignup is a 9-step wizard. The Cloudflare
# Turnstile widget div is conditionally rendered ONLY on the final
# step (`{step === totalSteps && <div ref={turnstileRef} ... />}`).
# The init useEffect must therefore re-fire when `step` changes, or
# `turnstileRef.current` is null on mount (step 1) and the render()
# call gets skipped -- silently, leaving therapists stuck on step 9
# with no widget.
#
# The fix in 626eace added `step` (and `totalSteps`) to the deps
# array. If a future refactor drops them, the bug returns and CI
# can't catch it: REACT_APP_TURNSTILE_SITE_KEY is unset in CI, so
# the widget code path is bypassed entirely in e2e tests.
#
# This script greps the deps line and fails CI if `step` is missing.
# Run after every commit: ./scripts/check_turnstile_deps.sh
# Exit 0 = clean, exit 1 = regression detected.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$REPO_ROOT/frontend/src/pages/TherapistSignup.jsx"

if [ ! -f "$FILE" ]; then
  echo "OK: TherapistSignup.jsx not present (skipping check)."
  exit 0
fi

# Find the useEffect that renders Turnstile. It's the only useEffect
# in the file whose body references `turnstile.render(` -- match on
# that, then walk forward to its closing deps array.
#
# We use python because bash regex across multi-line useEffect blocks
# is fragile, and python is already a build-time dep (scripts/ has
# .py files alongside .sh).
python3 - "$FILE" <<'PY'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
src = path.read_text(encoding="utf-8", errors="replace")

# Find each useEffect block. A block is `useEffect(() => { ... }, [DEPS]);`
# -- the closing `}, [...])` follows the body. Use a non-greedy match
# bounded by the deps array.
pattern = re.compile(
    r"useEffect\s*\(\s*\(\s*\)\s*=>\s*\{(?P<body>.*?)\}\s*,\s*\[(?P<deps>[^\]]*)\]\s*\)\s*;",
    re.DOTALL,
)

found_turnstile_effect = False
for m in pattern.finditer(src):
    body = m.group("body")
    if "turnstile.render(" not in body:
        continue
    found_turnstile_effect = True
    deps = [d.strip() for d in m.group("deps").split(",") if d.strip()]
    if "step" not in deps:
        print("FAIL: Turnstile init useEffect deps missing `step`.")
        print(f"      Current deps: {deps}")
        print("      The widget div only mounts on the final step; without")
        print("      `step` in the deps, the init useEffect runs once on")
        print("      mount when the div is not yet in the DOM, skips the")
        print("      render() call, and never re-fires when the user")
        print("      reaches step 9. Add `step` (and ideally `totalSteps`)")
        print("      to the deps array to restore the 626eace fix.")
        sys.exit(1)

if not found_turnstile_effect:
    print("WARN: No useEffect calling turnstile.render() found in "
          "TherapistSignup.jsx. If Turnstile was removed intentionally,")
    print("      delete scripts/check_turnstile_deps.sh and its CI hook.")
    # Don't fail -- absence might be intentional. The warning is enough.
    sys.exit(0)

print("OK: Turnstile init useEffect deps include `step`.")
sys.exit(0)
PY
