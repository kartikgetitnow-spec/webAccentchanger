"""
Gemini Authentication & Ephemeral Token Service.

Provides short-lived ephemeral tokens for client-side applications (web browsers / mobile apps)
to establish direct, authenticated WebSocket connections to the Gemini Multimodal Live API
without exposing the permanent GEMINI_API_KEY.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import HTTPException, status

from app.config import settings
from app.schemas.token import TokenResponse

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

logger = logging.getLogger("gemini_auth")

# Module-level singleton cache for the google.genai Client instance
_cached_client: Optional[object] = None


def get_gemini_client():
    """
    Retrieve or initialize the cached module-level singleton google.genai Client.
    Initializes Client with settings.GEMINI_API_KEY and Live API v1alpha configuration.
    """
    global _cached_client
    if _cached_client is not None:
        return _cached_client

    api_key = settings.GEMINI_API_KEY.strip()
    if not api_key:
        logger.error("GEMINI_API_KEY is not configured in settings.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured on the server. Please set GEMINI_API_KEY in .env",
        )

    if genai is None:
        logger.error("google-genai package is not installed.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google-genai SDK is not installed in the environment.",
        )

    try:
        # Live API ephemeral tokens require the v1alpha API version
        http_options = (
            types.HttpOptions(api_version="v1alpha")
            if types and hasattr(types, "HttpOptions")
            else None
        )
        if http_options:
            _cached_client = genai.Client(api_key=api_key, http_options=http_options)
        else:
            _cached_client = genai.Client(api_key=api_key)
        return _cached_client
    except Exception as exc:
        # Log failure without leaking the API key
        logger.error(f"Failed to initialize google.genai Client: {type(exc).__name__}: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to initialize Gemini Client with server credentials.",
        )


def create_ephemeral_token(
    user_id: str,
    room_id: str,
    voice: Optional[str] = None,
) -> TokenResponse:
    """
    Request an ephemeral authentication token from Gemini Live API.

    Steps:
      1. Retrieve/initialize cached Client with settings.GEMINI_API_KEY.
      2. Request an ephemeral token with:
         - expire_time = now + TOKEN_TTL_SECONDS
         - new_session_expire_time = now + TOKEN_TTL_SECONDS
         - Target Live API model
      3. Return the token, expires_at (unix timestamp), model name, voice, and full WebSocket URL.
    """
    selected_voice = voice or settings.GEMINI_VOICE

    # Safe logging: log user and room identifiers without leaking credentials
    logger.info(
        f"Requesting ephemeral token: user_id='{user_id}', room_id='{room_id}', voice='{selected_voice}'"
    )

    now = datetime.now(timezone.utc)
    ttl = settings.TOKEN_TTL_SECONDS
    expire_time = now + timedelta(seconds=ttl)
    new_session_expire_time = now + timedelta(seconds=ttl)
    expires_at_unix = int(expire_time.timestamp())

    client = get_gemini_client()
    raw_token: Optional[str] = None

    # Step: Request ephemeral token via google-genai SDK
    # Depending on SDK version, token provisioning may be accessed via
    # client.tokens.create(...) or client.auth_tokens.create(...),
    # or fallback to REST call.
    try:
        if hasattr(client, "tokens") and hasattr(client.tokens, "create"):
            create_config = {
                "uses": 1,
                "expire_time": expire_time,
                "new_session_expire_time": new_session_expire_time,
            }
            if types and hasattr(types, "CreateAuthTokenConfig"):
                token_obj = client.tokens.create(
                    config=types.CreateAuthTokenConfig(**create_config)
                )
            else:
                token_obj = client.tokens.create(**create_config)
            raw_token = getattr(token_obj, "token", getattr(token_obj, "name", str(token_obj)))

        elif hasattr(client, "auth_tokens") and hasattr(client.auth_tokens, "create"):
            create_config = {
                "uses": 1,
                "expire_time": expire_time,
                "new_session_expire_time": new_session_expire_time,
            }
            if types and hasattr(types, "CreateAuthTokenConfig"):
                token_obj = client.auth_tokens.create(
                    config=types.CreateAuthTokenConfig(**create_config)
                )
            else:
                try:
                    token_obj = client.auth_tokens.create(config=create_config)
                except TypeError:
                    token_obj = client.auth_tokens.create(**create_config)
            raw_token = getattr(token_obj, "name", getattr(token_obj, "token", str(token_obj)))

        else:
            # Fallback: Call Google Generative Language API directly via httpx
            import httpx

            rest_url = f"https://generativelanguage.googleapis.com/v1alpha/authTokens?key={settings.GEMINI_API_KEY}"
            payload = {
                "expireTime": expire_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "newSessionExpireTime": new_session_expire_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            response = httpx.post(rest_url, json=payload, timeout=12.0)
            if response.status_code == 200:
                data = response.json()
                raw_token = data.get("token") or data.get("name")
            else:
                raise Exception(
                    f"Gemini token endpoint returned status {response.status_code}: {response.text}"
                )

    except HTTPException:
        raise
    except Exception as exc:
        # Safe logging without leaking API key
        logger.error(
            f"Gemini API ephemeral token creation failed for user='{user_id}': {type(exc).__name__}: {str(exc)}"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Gemini API ephemeral token creation failed: {str(exc)}",
        )

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini service did not return a valid ephemeral token.",
        )

    full_ws_url = f"{settings.GEMINI_LIVE_WS_URL}?key={raw_token}"

    logger.info(f"Ephemeral token successfully created for user_id='{user_id}' (expires_at {expires_at_unix})")

    return TokenResponse(
        token=raw_token,
        expires_at=expires_at_unix,
        model=settings.GEMINI_MODEL,
        voice=selected_voice,
        ws_url=full_ws_url,
    )
