"""
Pydantic schemas for Gemini Live ephemeral token requests and responses.
"""

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class TokenRequest(BaseModel):
    """
    Request model for acquiring a Gemini Live API ephemeral token.
    """
    user_id: str = Field(..., description="Unique identifier for the user")
    room_id: str = Field(..., description="Identifier for the active call room")
    voice: Optional[str] = Field(
        default=None,
        description="Optional Gemini voice persona override (e.g., Puck, Charon, Aoede, Fenrir, Kore)"
    )

    @field_validator("user_id", "room_id")
    @classmethod
    def validate_non_empty_alphanumeric(cls, value: str, info) -> str:
        """
        Validates that the field is a non-empty string consisting of alphanumeric characters,
        dashes, or underscores.
        """
        if not isinstance(value, str):
            raise ValueError(f"{info.field_name} must be a string")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError(f"{info.field_name} cannot be empty")
        if not re.match(r"^[a-zA-Z0-9_-]+$", trimmed):
            raise ValueError(
                f"{info.field_name} must be non-empty alphanumeric (letters, numbers, underscores, and hyphens permitted)"
            )
        return trimmed


class TokenResponse(BaseModel):
    """
    Response model returning the ephemeral token and Gemini Live connection details.
    """
    token: str = Field(..., description="Ephemeral authentication token for Gemini Live API")
    expires_at: int = Field(..., description="Unix epoch timestamp in seconds when the token expires")
    model: str = Field(..., description="Target Gemini Live API model")
    voice: str = Field(..., description="Assigned voice persona")
    ws_url: str = Field(..., description="Full WebSocket endpoint URL to connect to Gemini Live")


class TokenHealthResponse(BaseModel):
    """Health check response for token service."""
    status: str = "ok"
    gemini_configured: bool = False
