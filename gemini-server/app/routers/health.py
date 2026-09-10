"""
Health Check Router for Gemini Voice Token Server.
"""

from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str
    gemini_api_key_loaded: bool


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """
    GET /health
    Reports server health, version, timestamp, and whether GEMINI_API_KEY is loaded.
    Never exposes the raw API key.
    """
    is_key_loaded = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip())
    return HealthResponse(
        status="ok",
        version=settings.VERSION,
        timestamp=datetime.now(timezone.utc).isoformat(),
        gemini_api_key_loaded=is_key_loaded,
    )
