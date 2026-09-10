"""
WebSocket Bridge service connecting client WebSockets to the Gemini Multimodal Live API.

Architecture & Tradeoff Analysis:
---------------------------------
Why this bridge exists:
1. Universal Client Compatibility: Some environments (legacy browsers, restricted webviews,
   or native clients without WebSocket subprotocol support) cannot directly maintain
   direct Gemini Live protocol connections.
2. Centralized Observability & Logging: Enables server-side monitoring of audio latency,
   token consumption, and conversation metrics without client reporting.
3. Server-Side Audio Transformation: Allows inserting server-side DSP, RVC voice conversion,
   or audio normalization pipeline between client and Gemini.

Direct-from-Browser vs. WebSocket Bridge Tradeoffs:
---------------------------------------------------
1. Latency:
   - Direct-from-Browser: Lowest latency (one network hop: Browser -> Gemini Edge).
   - WebSocket Bridge: Adds a second network hop (Browser -> Server -> Gemini), adding ~20-60ms.
2. Server Cost & Bandwidth:
   - Direct-from-Browser: Server handles only ephemeral token issuance (~1KB per session).
     Server bandwidth is near zero.
   - WebSocket Bridge: Continuous bi-directional 16kHz/24kHz PCM stream traverses the server,
     consuming server CPU, RAM, and egress bandwidth.
3. Security & Control:
   - Direct-from-Browser: Ephemeral token grants scoped, time-limited access without exposing master key.
   - WebSocket Bridge: Complete server-side control; can enforce content safety, rate limits, and
     custom turn management.

Recommendation: Prefer Direct-from-Browser with Ephemeral Tokens for production low-latency voice.
Use this WebSocket Bridge when server-side audio processing, recording, or proxying is required.
"""

import asyncio
import base64
import json
import logging
from typing import Optional
from fastapi import WebSocket, WebSocketDisconnect
import websockets

from app.config import settings

logger = logging.getLogger("gemini_live_bridge")


async def bridge_websocket(client_ws: WebSocket) -> None:
    """
    Bi-directional bridge between a client WebSocket and the Gemini Multimodal Live API.

    Lifecycle:
      1. Accept client connection at /ws/gemini.
      2. Read initial JSON config: { token, voice, system_prompt, model }.
      3. Connect to Gemini Live WebSocket using ephemeral token or server credentials.
      4. Send Gemini setup handshake (system instruction, voice persona, audio modal).
      5. Spawn two concurrent asynchronous forwarding loops:
         - Task A: Client -> Gemini (binary PCM 16kHz audio or JSON control frames).
         - Task B: Gemini -> Client (audio chunks, transcripts, turn completions).
      6. Gracefully terminate and close both sockets on disconnect.
    """
    await client_ws.accept()
    logger.info("Client connected to Gemini Live WebSocket Bridge.")

    gemini_ws: Optional[websockets.WebSocketClientProtocol] = None
    tasks = []

    try:
        # Step 2: Read initial handshake frame from client
        initial_raw = await client_ws.receive_text()
        try:
            config_data = json.loads(initial_raw)
        except json.JSONDecodeError:
            config_data = {}

        token = config_data.get("token") or settings.GEMINI_API_KEY
        voice = config_data.get("voice") or settings.GEMINI_VOICE
        system_prompt = config_data.get("system_prompt")
        model = config_data.get("model") or settings.GEMINI_MODEL

        if not token:
            await client_ws.send_json({
                "type": "error",
                "message": "No authentication token or Gemini API key provided."
            })
            await client_ws.close(code=1008)
            return

        # Step 3: Connect to Gemini Live WebSocket API
        gemini_url = f"{settings.GEMINI_LIVE_WS_URL}?key={token}"
        logger.info(f"Opening connection to Gemini Live API with voice='{voice}', model='{model}'...")

        gemini_ws = await websockets.connect(
            gemini_url,
            subprotocols=["default"],
            ping_interval=20,
            ping_timeout=20,
            max_size=10 * 1024 * 1024,
        )

        # Step 4: Send initial Gemini setup message
        setup_payload = {
            "setup": {
                "model": model,
                "generation_config": {
                    "response_modalities": ["AUDIO"],
                    "speech_config": {
                        "voice_config": {
                            "prebuilt_voice_config": {
                                "voice_name": voice
                            }
                        }
                    }
                }
            }
        }
        if system_prompt:
            setup_payload["setup"]["system_instruction"] = {
                "parts": [{"text": system_prompt}]
            }

        await gemini_ws.send(json.dumps(setup_payload))
        logger.info("Sent Gemini Live setup handshake.")

        # Wait for Gemini setup confirmation
        try:
            initial_gemini_resp = await asyncio.wait_for(gemini_ws.recv(), timeout=10.0)
            logger.info(f"Gemini Live setup response received: {initial_gemini_resp[:120]}...")
            await client_ws.send_json({
                "type": "ready",
                "model": model,
                "voice": voice,
                "detail": "Gemini Live session initialized."
            })
        except asyncio.TimeoutError:
            logger.warning("Gemini Live setup timed out; proceeding anyway.")

        # Step 5: Define bi-directional streaming tasks
        async def client_to_gemini():
            """Forward audio and control frames from Client to Gemini Live."""
            try:
                while True:
                    frame = await client_ws.receive()
                    if frame.get("type") == "websocket.disconnect":
                        break

                    # Binary frame: Raw PCM 16kHz Mono Int16 Audio
                    if "bytes" in frame and frame["bytes"]:
                        raw_bytes = frame["bytes"]
                        b64_audio = base64.b64encode(raw_bytes).decode("utf-8")
                        gemini_msg = {
                            "realtime_input": {
                                "media_chunks": [
                                    {
                                        "mime_type": "audio/pcm;rate=16000",
                                        "data": b64_audio,
                                    }
                                ]
                            }
                        }
                        await gemini_ws.send(json.dumps(gemini_msg))

                    # Text/JSON control frame
                    elif "text" in frame and frame["text"]:
                        text_content = frame["text"]
                        try:
                            ctrl = json.loads(text_content)
                            if ctrl.get("type") == "audio_chunk" and ctrl.get("data"):
                                # Base64 audio chunk in JSON
                                gemini_msg = {
                                    "realtime_input": {
                                        "media_chunks": [
                                            {
                                                "mime_type": "audio/pcm;rate=16000",
                                                "data": ctrl["data"],
                                            }
                                        ]
                                    }
                                }
                                await gemini_ws.send(json.dumps(gemini_msg))
                            elif ctrl.get("type") == "text":
                                # User text input / prompt
                                text_msg = {
                                    "client_content": {
                                        "turns": [
                                            {
                                                "role": "user",
                                                "parts": [{"text": ctrl["text"]}],
                                            }
                                        ],
                                        "turn_complete": True,
                                    }
                                }
                                await gemini_ws.send(json.dumps(text_msg))
                            elif ctrl.get("type") == "ping":
                                await client_ws.send_json({"type": "pong"})
                        except json.JSONDecodeError:
                            # Forward plain text
                            text_msg = {
                                "client_content": {
                                    "turns": [
                                        {
                                            "role": "user",
                                            "parts": [{"text": text_content}],
                                        }
                                    ],
                                    "turn_complete": True,
                                }
                            }
                            await gemini_ws.send(json.dumps(text_msg))
            except WebSocketDisconnect:
                logger.info("Client WebSocket disconnected in client_to_gemini loop.")
            except Exception as exc:
                logger.error(f"Error in client_to_gemini loop: {exc}")

        async def gemini_to_client():
            """Forward Gemini Live audio and text turns to Client."""
            try:
                async for raw_response in gemini_ws:
                    try:
                        resp_data = json.loads(raw_response)
                    except json.JSONDecodeError:
                        continue

                    server_content = resp_data.get("serverContent")
                    if not server_content:
                        continue

                    # Handle model turn (audio and transcript parts)
                    model_turn = server_content.get("modelTurn")
                    if model_turn:
                        parts = model_turn.get("parts", [])
                        for part in parts:
                            inline_data = part.get("inlineData")
                            if inline_data:
                                # Forward audio chunk
                                mime_type = inline_data.get("mimeType", "audio/pcm;rate=24000")
                                b64_data = inline_data.get("data", "")
                                await client_ws.send_json({
                                    "type": "audio",
                                    "mime_type": mime_type,
                                    "data": b64_data,
                                })

                            if "text" in part:
                                # Forward text transcript
                                await client_ws.send_json({
                                    "type": "text",
                                    "text": part["text"],
                                })

                    # Handle turn complete notification
                    if server_content.get("turnComplete"):
                        await client_ws.send_json({"type": "turn_complete"})

                    # Handle model interruption
                    if server_content.get("interrupted"):
                        await client_ws.send_json({"type": "interrupted"})

            except websockets.exceptions.ConnectionClosed:
                logger.info("Gemini WebSocket connection closed.")
            except Exception as exc:
                logger.error(f"Error in gemini_to_client loop: {exc}")

        # Run both tasks concurrently
        task_a = asyncio.create_task(client_to_gemini())
        task_b = asyncio.create_task(gemini_to_client())
        tasks = [task_a, task_b]

        done, pending = await asyncio.wait(
            tasks,
            return_when=asyncio.FIRST_COMPLETED,
        )

        for p in pending:
            p.cancel()

    except WebSocketDisconnect:
        logger.info("Client WebSocket disconnected gracefully.")
    except Exception as exc:
        logger.error(f"WebSocket bridge error: {type(exc).__name__}: {exc}")
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
        if gemini_ws:
            try:
                await gemini_ws.close()
            except Exception:
                pass
            logger.info("Gemini WebSocket connection closed.")
        logger.info("WebSocket bridge session finalized.")
