"""
Main FastAPI application entrypoint for the Gemini Voice Token Server.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.config import settings
from app.routers.tokens import router as tokens_router
from app.routers.health import router as health_router
from app.routers.live import router as live_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("gemini_server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup event
    logger.info(f"Gemini Voice Token Server ready on port {settings.PORT}")
    yield
    # Shutdown event
    logger.info("Gemini Voice Token Server shutting down.")


app = FastAPI(
    title="Gemini Voice Token Server",
    version=settings.VERSION,
    description="Microservice providing ephemeral tokens and WebSocket bridge for Gemini Multimodal Live API.",
    lifespan=lifespan,
)

# CORS middleware with settings.ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
# Mount tokens router under both root and /api for convenience
app.include_router(tokens_router, prefix="")
app.include_router(tokens_router, prefix="/api")
app.include_router(health_router, prefix="")
app.include_router(live_router, prefix="")


@app.get("/")
async def root():
    """Root landing endpoint providing service metadata."""
    return {
        "message": "Gemini Voice Token Server",
        "docs": "/docs",
        "health": "/health",
        "token_endpoint": "/token",
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
