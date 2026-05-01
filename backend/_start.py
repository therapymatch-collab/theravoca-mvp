from server import app
import pathlib, os, base64
from fastapi.responses import FileResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

_SPW = os.environ.get("STAGING_PASSWORD", "")

# Routes that must be publicly accessible even when staging auth is on
_PUBLIC_PREFIXES = (
    "/verify/",
    "/api/requests/verify/",
    "/sign-in",
    "/results/",
    "/api/requests/results/",
    "/api/site-copy",
    "/api/faqs",
    "/therapist/apply/",
    "/api/therapists/apply/",
    "/feedback/",
    "/api/feedback",
    "/api/portal/magic-code",
    "/api/portal/verify-magic-code",
    "/api/stripe/webhook",
)

class BasicAuth(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not _SPW:
            return await call_next(request)
        path = request.url.path
        # Allow public routes through without auth
        if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
            return await call_next(request)
        # Allow static assets (JS, CSS, images, fonts)
        if any(path.endswith(ext) for ext in ('.js', '.css', '.png', '.jpg', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.json', '.map')):
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                d = base64.b64decode(auth[6:]).decode()
                _, pw = d.split(":", 1)
                if pw == _SPW:
                    return await call_next(request)
            except Exception:
                pass
        return Response("", status_code=401, headers={"WWW-Authenticate": 'Basic realm="TheraVoca Staging"'})

app.add_middleware(BasicAuth)

_sd = pathlib.Path(__file__).parent / "static_build"
if _sd.exists():
    @app.get("/{fp:path}")
    async def serve_spa(fp: str):
        f = _sd / fp
        if f.exists() and f.is_file():
            return FileResponse(str(f))
        return FileResponse(str(_sd / "index.html"))
