"""
WebSocket Router for Gemini Live Bridge.
"""

import logging
from fastapi import APIRouter, WebSocket
from app.services.gemini_live import bridge_websocket

logger = logging.getLogger("live_router")

router = APIRouter(tags=["live"])


@router.websocket("/ws/gemini")
async def gemini_live_websocket(websocket: WebSocket):
    """
    WebSocket endpoint bridging client audio stream with Gemini Multimodal Live API.
    Supports binary PCM (16kHz mono 16-bit) and JSON control packets.
    """
    await bridge_websocket(websocket)
