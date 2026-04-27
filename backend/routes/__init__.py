"""Route module aggregator."""
from fastapi import APIRouter

from .admin import router as admin_router
from .patients import router as patients_router
from .portal import router as portal_router
from .stripe_webhook import router as stripe_router
from .therapists import router as therapists_router

api_router = APIRouter(prefix="/api")
api_router.include_router(patients_router)
api_router.include_router(therapists_router)
api_router.include_router(portal_router)
api_router.include_router(admin_router)
api_router.include_router(stripe_router)

__all__ = ["api_router"]
