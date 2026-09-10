"""
Token Router for Gemini Ephemeral Tokens.

Endpoints:
- POST /token or /api/token: Issues an ephemeral token with per-user rate limiting.
- GET /token/health or /api/token/health: Health check for Gemini token generation.
"""

import time
import logging
from typing import Dict, List
from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.schemas.token import TokenRequest, TokenResponse, TokenHealthResponse
from app.services.gemini_auth import create_ephemeral_token

logger = logging.getLogger("tokens_router")

router = APIRouter(tags=["tokens"])

# In-memory rate limiting store: maps user_id -> list of float epoch timestamps
_user_request_timestamps: Dict[str, List[float]] = {}
RATE_LIMIT_WINDOW_SECONDS = 60.0
MAX_REQUESTS_PER_MINUTE = settings.MAX_REQUESTS_PER_MINUTE


def _check_rate_limit(user_id: str) -> None:
    """
    Enforce a simple in-memory rate limit of max requests per minute per user_id.
    Discards timestamps older than 60 seconds.
    """
    now = time.time()
    user_timestamps = _user_request_timestamps.get(user_id, [])

    # Retain only timestamps within the active 60-second sliding window
    recent_timestamps = [t for t in user_timestamps if (now - t) < RATE_LIMIT_WINDOW_SECONDS]

    if len(recent_timestamps) >= MAX_REQUESTS_PER_MINUTE:
        logger.warning(
            f"Rate limit exceeded for user_id='{user_id}' ({len(recent_timestamps)} requests in {RATE_LIMIT_WINDOW_SECONDS}s)"
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: maximum {MAX_REQUESTS_PER_MINUTE} token requests per minute allowed per user.",
        )

    recent_timestamps.append(now)
    _user_request_timestamps[user_id] = recent_timestamps


@router.post("/token", response_model=TokenResponse)
async def request_ephemeral_token(body: TokenRequest) -> TokenResponse:
    """
    Generates a short-lived ephemeral token for direct browser WebSocket connections
    to the Gemini Multimodal Live API.
    """
    _check_rate_limit(body.user_id)

    return create_ephemeral_token(
        user_id=body.user_id,
        room_id=body.room_id,
        voice=body.voice,
    )


@router.get("/token/health", response_model=TokenHealthResponse)
async def get_token_health() -> TokenHealthResponse:
    """
    Returns health status and confirms whether the GEMINI_API_KEY is configured.
    """
    is_configured = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip())
    return TokenHealthResponse(
        status="ok",
        gemini_configured=is_configured,
    )
