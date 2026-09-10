"""
Configuration settings for Gemini Voice Token Server using pydantic-settings.
Loads environment variables from .env file or system environment.
"""

from typing import List, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration and environment settings."""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Google Gemini API Key (keep secret on server)
    GEMINI_API_KEY: str = Field(
        default="",
        description="Google Gemini API Key"
    )

    # CORS Allowed Origins
    ALLOWED_ORIGINS: Union[str, List[str]] = Field(
        default=["http://localhost:3000"],
        description="List of allowed origins for CORS requests"
    )

    # Server Port & Host
    PORT: int = Field(default=8000, description="Port to bind the server")
    HOST: str = Field(default="0.0.0.0", description="Host to bind the server")

    # Ephemeral Token Configuration
    TOKEN_TTL_SECONDS: int = Field(
        default=1800,
        description="Ephemeral token time-to-live in seconds (default: 1800s = 30 min)"
    )

    # Gemini Multimodal Live API Settings
    GEMINI_MODEL: str = Field(
        default="models/gemini-2.5-flash-native-audio-latest",
        description="Gemini model identifier for Live API sessions"
    )
    GEMINI_VOICE: str = Field(
        default="Puck",
        description="Voice persona name (e.g. Puck, Charon, Aoede, Fenrir, Kore)"
    )

    # Base WebSocket URL for Gemini Live
    GEMINI_LIVE_WS_URL: str = Field(
        default="wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained",
        description="Base WebSocket URL for Gemini Multimodal Live API"
    )
    MAX_REQUESTS_PER_MINUTE: int = Field(
        default=10,
        description="Max token requests per minute per user_id"
    )
    VERSION: str = Field(default="1.0.0", description="API Version")

    @field_validator("ALLOWED_ORIGINS", mode="after")
    @classmethod
    def parse_allowed_origins(cls, value: Union[str, List[str]]) -> List[str]:
        """Support comma-separated string or list for ALLOWED_ORIGINS."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


# Singleton settings instance
settings = Settings()
