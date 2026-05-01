"""Route module aggregator."""
from fastapi import APIRouter

from .admin import router as admin_router, public_router as admin_public_router
from .blog import router as blog_router
from .faqs import router as faqs_router
from .feedback import router as feedback_router
from .master_query import router as master_query_router
from .patients import router as patients_router
from .portal import router as portal_router
from .site_copy import router as site_copy_router
from .stripe_webhook import router as stripe_router
from .therapists import router as therapists_router

api_router = APIRouter(prefix="/api")
api_router.include_router(patients_router)
api_router.include_router(therapists_router)
api_router.include_router(portal_router)
api_router.include_router(admin_router)
api_router.include_router(admin_public_router)
api_router.include_router(feedback_router)
api_router.include_router(blog_router)
api_router.include_router(faqs_router)
api_router.include_router(master_query_router)
api_router.include_router(site_copy_router)
api_router.include_router(stripe_router)

__all__ = ["api_router"]
