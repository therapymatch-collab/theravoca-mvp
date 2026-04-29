"""Mobile-viewport smoke tests for high-traffic patient routes.

Run: `pytest backend/tests/test_mobile_smoke.py`

These tests catch the class of bug that broke `/results/{id}` in iter-73
(missing `const copy = useSiteCopy()` → runtime ReferenceError on mobile).
We render each route in a 390x844 viewport, listen for `pageerror`
(uncaught JS exceptions) AND console errors, and fail if anything
sketchy happens during initial load.

Each test runs in <10s, the full suite in <60s.
"""
from __future__ import annotations

import os
import re
import asyncio
import pytest

pytest.importorskip("playwright")

from playwright.async_api import async_playwright


# ─── Test config ─────────────────────────────────────────────────────
def _frontend_url() -> str:
    """Strip `/api` if accidentally included in REACT_APP_BACKEND_URL."""
    raw = os.environ.get("REACT_APP_BACKEND_URL") or ""
    if not raw:
        try:
            with open("/app/frontend/.env", "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("REACT_APP_BACKEND_URL"):
                        raw = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except OSError:
            pass
    return raw.rstrip("/")


HOMEPAGE_ROUTES = [
    "/",
    "/#start",
    "/sign-in",
    "/portal/patient",
    "/therapists/join",
    "/blog/why-finding-a-therapist-is-hard",
]


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def _is_benign_console_error(text: str) -> bool:
    """Console errors we tolerate during smoke tests.

    React dev-mode warnings, third-party scripts (Cloudflare Turnstile,
    feedback widget, embedded analytics), and 4xx on optional preview
    images are not deal-breakers — they fire on production sites too.
    """
    benign_patterns = (
        r"Warning:",                       # React dev warnings
        r"Failed to load resource.*image", # missing optional photo
        r"net::ERR_BLOCKED_BY_CLIENT",     # adblock
        r"Failed to load resource.*40[0-9]",  # missing optional asset
        r"feedback",                       # feedback widget noise
        r"emergent.*sh",                   # emergent build banner
        r"Warning: ReactDOM\.render",      # legacy CRA
        r"Receive notification",
        r"deprecated",
        r"TrustedHTML",                    # third-party CSP noise
        r"TrustedScript",                  # third-party CSP noise
        r"font-size:0",                    # third-party widget logger
        r"color:transparent",              # third-party widget logger
        r"Cloudflare",                     # turnstile telemetry
        r"turnstile",                      # turnstile telemetry
        r"Permissions policy",             # browser-feature gating
        r"xr-spatial-tracking",            # browser-feature gating
        r"Content Security Policy",        # CSP nonce noise
        r"inline script",                  # CSP nonce noise
        r"Mixed Content",                  # mixed-content blocks
        r"401\b",                          # third-party 401
        r"403\b",                          # third-party 403
    )
    if not text:
        return True
    return any(re.search(p, text, re.IGNORECASE) for p in benign_patterns)


async def _smoke_render(url: str) -> list[str]:
    """Open `url` in a 390x844 mobile context and collect runtime errors.
    Returns a (filtered) list — empty on success."""
    errors: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        )
        page = await context.new_page()
        page.on("pageerror", lambda exc: errors.append(f"PAGEERROR: {exc}"))
        page.on(
            "console",
            lambda m: errors.append(f"CONSOLE: {m.text}")
            if m.type == "error" and not _is_benign_console_error(m.text)
            else None,
        )
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(2500)
            body = await page.evaluate("document.body.innerText")
            assert body and len(body.strip()) > 30, (
                f"page body is empty or too short ({body[:100]!r})"
            )
        finally:
            await context.close()
            await browser.close()
    return errors


@pytest.mark.asyncio
@pytest.mark.parametrize("path", HOMEPAGE_ROUTES)
async def test_mobile_smoke_route(path: str):
    """Each public route must render at 390x844 without runtime errors."""
    base = _frontend_url()
    if not base:
        pytest.skip("REACT_APP_BACKEND_URL not configured")
    errors = await _smoke_render(f"{base}{path}")
    if errors:
        pytest.fail(f"{path} produced runtime errors:\n  " + "\n  ".join(errors[:5]))


@pytest.mark.asyncio
async def test_mobile_smoke_results_page():
    """Dynamic-id route: /results/{id}?t={view_token}. Looks up a real
    verified request from the DB; skips if none exist. THIS is the test
    that would have caught the iter-73 mobile crash (`Can't find
    variable: copy`)."""
    base = _frontend_url()
    if not base:
        pytest.skip("REACT_APP_BACKEND_URL not configured")
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError:
        pytest.skip("motor not installed")
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        pytest.skip("MONGO_URL not set")
    cli = AsyncIOMotorClient(mongo_url)
    try:
        db = cli[db_name]
        req = await db.requests.find_one(
            {"verified": True, "view_token": {"$ne": None}},
            {"id": 1, "view_token": 1, "_id": 0},
        )
    finally:
        cli.close()
    if not req:
        pytest.skip("No verified request in DB with a view_token")
    url = f"{base}/results/{req['id']}?t={req['view_token']}"
    errors = await _smoke_render(url)
    if errors:
        pytest.fail(
            "/results/{id} produced runtime errors:\n  " + "\n  ".join(errors[:5]),
        )
