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

function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
  const isDirectGeminiRef = useRef<boolean>(true);

  // Helper to fetch ephemeral token from server
  const fetchToken = useCallback(async (): Promise<TokenApiResponse | null> => {
    try {
      let baseUrl = process.env.NEXT_PUBLIC_GEMINI_SERVER_URL || 'https://65-2-161-214.sslip.io';
      if (baseUrl.includes('65.2.161.214') && !baseUrl.includes('sslip.io')) {
        baseUrl = 'https://65-2-161-214.sslip.io';
      }
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const tokenUrl = isHttps && baseUrl.startsWith('http://') ? '/api/token' : `${baseUrl.replace(/\/+$/, '')}/api/token`;

      const res = await fetch(tokenUrl, {
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
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to obtain Gemini token';
        setError(msg);
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
      if (isDirectGeminiRef.current) {
        // Direct Gemini Live WebSocket: send base64 PCM in realtime_input frame
        const base64Audio = arrayBufferToBase64(pcmChunk);
        const msg = JSON.stringify({
          realtime_input: {
            media_chunks: [
              {
                mime_type: 'audio/pcm;rate=16000',
                data: base64Audio,
              },
            ],
          },
        });
        activeWs.send(msg);
      } else {
        // FastAPI bridge: accepts binary PCM ArrayBuffer directly
        activeWs.send(pcmChunk);
      }
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

      // Direct client-to-Gemini Live API over secure WSS using ephemeral token
      let wsEndpoint = tokenData.ws_url;
      if (wsEndpoint && wsEndpoint.includes('key=auth_tokens/')) {
        wsEndpoint = wsEndpoint
          .replace('BidiGenerateContent?', 'BidiGenerateContentConstrained?')
          .replace('key=auth_tokens/', 'access_token=auth_tokens/');
      }

      // If ws_url is not set, fall back to remote FastAPI bridge
      if (!wsEndpoint) {
        let baseUrl = process.env.NEXT_PUBLIC_GEMINI_SERVER_URL || 'https://65-2-161-214.sslip.io';
        if (baseUrl.includes('65.2.161.214') && !baseUrl.includes('sslip.io')) {
          baseUrl = 'https://65-2-161-214.sslip.io';
        }
        wsEndpoint = baseUrl.replace(/^http(s)?:\/\//, (_, s) => (s ? 'wss://' : 'ws://')).replace(/\/+$/, '') + '/ws/gemini';
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && wsEndpoint.startsWith('ws://')) {
          wsEndpoint = wsEndpoint.replace('ws://', 'wss://');
        }
      }

      const isDirect = wsEndpoint.includes('generativelanguage.googleapis.com');
      isDirectGeminiRef.current = isDirect;

      try {
        const socket = new WebSocket(wsEndpoint);
        socket.binaryType = 'arraybuffer';
        wsRef.current = socket;
        setWsState(socket);

        socket.onopen = () => {
          if (!active) return;
          setIsConnected(true);
          setError(null);

          if (isDirect) {
            // Direct Gemini Live setup frame
            const setupMsg = {
              setup: {
                model: 'models/gemini-2.5-flash-native-audio-latest',
                generation_config: {
                  response_modalities: ['AUDIO'],
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: {
                        voice_name: voice || 'Puck',
                      },
                    },
                  },
                },
                system_instruction: {
                  parts: [
                    {
                      text: systemPrompt || 'You are an AI voice transformer. Speak in Puck voice.',
                    },
                  ],
                },
              },
            };
            socket.send(JSON.stringify(setupMsg));
          } else {
            // FastAPI bridge handshake frame
            socket.send(
              JSON.stringify({
                token: tokenData.token,
                voice: voice || tokenData.voice || 'Puck',
                system_prompt: systemPrompt || 'You are an AI voice transformer. Speak in Puck voice.',
              })
            );
          }
        };

        socket.onmessage = async (event) => {
          if (!active) return;

          // Raw PCM ArrayBuffer (from bridge)
          if (event.data instanceof ArrayBuffer) {
            audioCallbacksRef.current.forEach((cb) => cb(event.data));
          } else if (event.data instanceof Blob) {
            const buffer = await event.data.arrayBuffer();
            audioCallbacksRef.current.forEach((cb) => cb(buffer));
          } else if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data);

              // 1. Direct Gemini setup complete
              if (msg.setupComplete) {
                setIsConnected(true);
                setError(null);
              }

              // 2. Direct Gemini audio stream chunks
              if (msg.serverContent?.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) {
                    const binaryStr = atob(part.inlineData.data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                      bytes[i] = binaryStr.charCodeAt(i);
                    }
                    audioCallbacksRef.current.forEach((cb) => cb(bytes.buffer));
                  }
                }
              }

              // 3. FastAPI bridge messages
              if (msg.type === 'ready') {
                setIsConnected(true);
                setError(null);
              } else if (msg.type === 'audio' && msg.data) {
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
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize WebSocket';
          setError(msg);
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
