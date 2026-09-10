'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface UseGeminiVoiceOptions {
  roomId: string;
  userId: string;
  voice?: string;
  systemPrompt?: string;
  enabled?: boolean;
}

export interface UseGeminiVoiceReturn {
  token: string | null;
  ws: WebSocket | null;
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  sendAudio: (pcmChunk: ArrayBuffer | ArrayBufferLike) => void;
  onAudioResponse: (callback: (pcm: ArrayBuffer) => void) => () => void;
  close: () => void;
}

interface TokenApiResponse {
  token: string;
  expires_at: number;
  model: string;
  voice: string;
  ws_url: string;
}

export function useGeminiVoice({
  roomId,
  userId,
  voice = 'Puck',
  systemPrompt,
  enabled = true,
}: UseGeminiVoiceOptions): UseGeminiVoiceReturn {
  const [token, setToken] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<WebSocket | null>(null);
  const audioCallbacksRef = useRef<Set<(pcm: ArrayBuffer) => void>>(new Set());
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Helper to fetch ephemeral token from server
  const fetchToken = useCallback(async (): Promise<TokenApiResponse | null> => {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_GEMINI_SERVER_URL || 'http://localhost:8000';
      const res = await fetch(`${baseUrl}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          room_id: roomId,
          voice,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Token request failed with status ${res.status}`);
      }

      const data: TokenApiResponse = await res.json();
      return data;
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to obtain Gemini token');
      }
      return null;
    }
  }, [userId, roomId, voice]);

  const fetchTokenRef = useRef(fetchToken);
  fetchTokenRef.current = fetchToken;

  // Close connection and cleanup with state guard to prevent render loops
  const close = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
      setWsState(null);
    }
    // Identity guard: only trigger state update if currently true
    setIsConnected((prev) => (prev ? false : prev));
    setIsStreaming((prev) => (prev ? false : prev));
  }, []);

  const closeRef = useRef(close);
  closeRef.current = close;

  // Send PCM audio chunk to WebSocket
  const sendAudio = useCallback((pcmChunk: ArrayBuffer | ArrayBufferLike) => {
    const activeWs = wsRef.current;
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(pcmChunk);
      setIsStreaming((prev) => (prev ? prev : true));
    } else {
      console.warn('[useGeminiVoice] Cannot send audio: WebSocket is not open.');
    }
  }, []);

  // Subscribe to received transformed AI audio
  const onAudioResponse = useCallback((callback: (pcm: ArrayBuffer) => void) => {
    audioCallbacksRef.current.add(callback);
    return () => {
      audioCallbacksRef.current.delete(callback);
    };
  }, []);

  // Initialize session and connect WebSocket
  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled || !userId || !roomId) return;

    let active = true;

    async function initSession() {
      setError(null);
      const tokenData = await fetchTokenRef.current();
      if (!active || !tokenData) return;

      setToken(tokenData.token);

      // Schedule token refresh if expires_at is approaching (< now + 60s)
      const nowSec = Math.floor(Date.now() / 1000);
      const secondsUntilExpiry = tokenData.expires_at - nowSec;
      const refreshDelaySec = Math.max(secondsUntilExpiry - 60, 10);

      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        if (!active) return;
        const refreshed = await fetchTokenRef.current();
        if (refreshed && active) {
          setToken(refreshed.token);
        }
      }, refreshDelaySec * 1000);

      // Open WebSocket to ${NEXT_PUBLIC_GEMINI_SERVER_URL}/ws/gemini
      const baseUrl = process.env.NEXT_PUBLIC_GEMINI_SERVER_URL || 'http://localhost:8000';
      const wsEndpoint = baseUrl.replace(/^http(s)?:\/\//, (_, s) => (s ? 'wss://' : 'ws://')) + '/ws/gemini';

      try {
        const socket = new WebSocket(wsEndpoint);
        socket.binaryType = 'arraybuffer';
        wsRef.current = socket;
        setWsState(socket);

        socket.onopen = () => {
          if (!active) return;
          setIsConnected(true);
          setError(null);

          // Initial handshake frame
          socket.send(
            JSON.stringify({
              token: tokenData.token,
              voice: voice || tokenData.voice || 'Puck',
              system_prompt: systemPrompt || 'You are an AI voice transformer. Speak in Puck voice.',
            })
          );
        };

        socket.onmessage = async (event) => {
          if (!active) return;

          // Raw PCM ArrayBuffer
          if (event.data instanceof ArrayBuffer) {
            audioCallbacksRef.current.forEach((cb) => cb(event.data));
          } else if (event.data instanceof Blob) {
            const buffer = await event.data.arrayBuffer();
            audioCallbacksRef.current.forEach((cb) => cb(buffer));
          } else if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'audio' && msg.data) {
                // Decode base64 audio
                const binaryStr = atob(msg.data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                audioCallbacksRef.current.forEach((cb) => cb(bytes.buffer));
              } else if (msg.type === 'error') {
                setError(msg.message || 'Gemini bridge error');
              }
            } catch {
              // Ignore non-JSON messages
            }
          }
        };

        socket.onerror = (err) => {
          if (!active) return;
          console.error('[useGeminiVoice] WebSocket error:', err);
          setError('WebSocket connection to Gemini Voice bridge failed.');
        };

        socket.onclose = (event) => {
          if (!active) return;
          setIsConnected(false);
          setIsStreaming(false);
          if (event.code !== 1000 && !event.wasClean) {
            setError(`WebSocket closed unexpectedly (code ${event.code})`);
          }
        };
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Failed to initialize WebSocket');
        }
      }
    }

    initSession();

    return () => {
      active = false;
      isMountedRef.current = false;
      closeRef.current();
    };
  }, [roomId, userId, voice, systemPrompt, enabled]);

  // Memoize return object to guarantee reference stability across parent renders
  return useMemo(
    () => ({
      token,
      ws: wsState,
      isConnected,
      isStreaming,
      error,
      sendAudio,
      onAudioResponse,
      close,
    }),
    [token, wsState, isConnected, isStreaming, error, sendAudio, onAudioResponse, close]
  );
}

export default useGeminiVoice;
