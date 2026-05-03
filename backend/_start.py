"""Staging wrapper for TheraVoca backend.

Adds HTTP Basic Auth to all routes EXCEPT those in _PUBLIC_PREFIXES
(login/auth flows, public API endpoints that have their own auth, etc.)
and serves the React SPA from static_build/ for all non-API routes.

Start command: uvicorn _start:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import base64
import os
import secrets

from starlette.requests import Request
from starlette.responses import PlainTextResponse, FileResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from server import app as fastapi_app

STAGING_USER = os.environ.get("STAGING_USER", "theravoca")
STAGING_PASSWORD = os.environ.get("STAGING_PASSWORD", "")

# Routes that bypass staging basic auth entirely.
# These either have their own auth (JWT sessions, admin password)
# or are public-facing endpoints patients/therapists hit from
# unauthenticated contexts (email links, intake form, etc.).
_PUBLIC_PREFIXES = (
    # Frontend SPA routes that patients access from email links
    "/verify/",
    "/sign-in",
    "/results/",
    "/therapist/apply/",
    "/feedback/",
    # Backend API — auth endpoints (login, magic codes, passwords)
    "/api/auth/",
    # Backend API — patient request endpoints (intake form, verification)
    "/api/requests/",
    # Backend API — therapist apply/decline (accessed from email links)
    "/api/therapists/apply/",
    "/api/therapist/apply/",
    "/api/therapist/decline/",
    # Backend API — waitlist (out-of-state signups)
    "/api/waitlist",
    "/api/therapist-waitlist",
    # Backend API — public content
    "/api/site-copy",
    "/api/faqs",
    "/api/blog",
    # Backend API — Stripe webhook (has its own signature verification)
    "/api/stripe/webhook",
    # Backend API — portal (has its own JWT session auth)
    "/api/portal/",
    # Backend API — feedback (public, patient-facing)
    "/api/feedback",
    # Backend API — build version (public, read-only)
    "/api/version",
    # Health check
    "/health",
    # Static assets (JS, CSS, images, fonts)
    "/static/",
    "/favicon",
    "/manifest",
    "/asset-manifest",
    "/logo",
)


class _BasicAuthMiddleware:
    """ASGI middleware that wraps the FastAPI app with HTTP Basic Auth
    for staging/preview environments. Public routes are exempted."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        # Skip auth for public routes
        if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
            await self.app(scope, receive, send)
            return

        # Skip if no staging password configured
        if not STAGING_PASSWORD:
            await self.app(scope, receive, send)
            return

        # Check for valid Basic Auth header
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")

        authenticated = False
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
                user, pwd = decoded.split(":", 1)
                if secrets.compare_digest(user, STAGING_USER) and secrets.compare_digest(
                    pwd, STAGING_PASSWORD
                ):
                    authenticated = True
            except Exception:
                pass

        if not authenticated:
            response = PlainTextResponse(
                "Authentication required",
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="TheraVoca Staging"'},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


# Wrap the FastAPI app with basic auth
_authed_app = _BasicAuthMiddleware(fastapi_app)

# Static file serving for the React SPA
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static_build")
_INDEX_HTML = os.path.join(_STATIC_DIR, "index.html")
_HAS_STATIC = os.path.isdir(_STATIC_DIR) and os.path.isfile(_INDEX_HTML)


def _check_basic_auth(scope: Scope) -> bool:
    """Return True if the request has valid Basic Auth credentials,
    or if no STAGING_PASSWORD is configured (auth disabled)."""
    if not STAGING_PASSWORD:
        return True
    headers = dict(scope.get("headers", []))
    auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
    if auth_header.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
            user, pwd = decoded.split(":", 1)
            if secrets.compare_digest(user, STAGING_USER) and secrets.compare_digest(
                pwd, STAGING_PASSWORD
            ):
                return True
        except Exception:
            pass
    return False


class _SPAApp:
    """ASGI app that serves the React SPA for non-API routes and delegates
    API/health routes to the FastAPI backend (with basic auth)."""

    def __init__(self, api_app: ASGIApp):
        self.api_app = api_app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.api_app(scope, receive, send)
            return

        path = scope.get("path", "")

        # Dynamic robots.txt — block all crawlers on staging
        if path == "/robots.txt":
            if STAGING_PASSWORD:
                body = "User-agent: *\nDisallow: /\n"
            else:
                body = "User-agent: *\nDisallow: /api/\nDisallow: /admin/\nSitemap: {}\n".format(
                    os.environ.get("PUBLIC_APP_URL", "") + "/sitemap.xml"
                )
            response = PlainTextResponse(body, media_type="text/plain")
            await response(scope, receive, send)
            return

        # API routes → FastAPI backend (auth middleware handles these)
        if path.startswith("/api/") or path == "/health":
            await self.api_app(scope, receive, send)
            return

        # ── Frontend routes: enforce Basic Auth before serving SPA ──
        # Static assets (JS/CSS/images/fonts) are exempted so the
        # browser can load them after the user authenticates on the
        # HTML page. Everything else (HTML pages) requires auth.
        is_static_asset = any(path.startswith(p) for p in (
            "/static/", "/favicon", "/manifest", "/asset-manifest", "/logo",
        ))

        if not is_static_asset and not any(
            path.startswith(p) for p in _PUBLIC_PREFIXES
        ):
            if not _check_basic_auth(scope):
                response = PlainTextResponse(
                    "Authentication required",
                    status_code=401,
                    headers={"WWW-Authenticate": 'Basic realm="TheraVoca Staging"'},
                )
                await response(scope, receive, send)
                return

        # Try to serve static file
        if _HAS_STATIC:
            # Check if it's a real static file (JS, CSS, image, etc.)
            file_path = os.path.join(_STATIC_DIR, path.lstrip("/"))
            if os.path.isfile(file_path) and not path == "/":
                response = FileResponse(file_path)
                await response(scope, receive, send)
                return

            # For all other routes, serve index.html (SPA client-side routing)
            response = FileResponse(_INDEX_HTML, media_type="text/html")
            await response(scope, receive, send)
            return

        # No static build — fall through to FastAPI (which will 404)
        await self.api_app(scope, receive, send)


app = _SPAApp(_authed_app)
