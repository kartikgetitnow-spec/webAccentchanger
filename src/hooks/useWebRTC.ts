'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import SimplePeer, { Instance as SimplePeerInstance } from 'simple-peer';
import { Participant, MessageType } from '@/lib/types';
import { ICE_SERVERS, AUDIO_CONSTRAINTS } from '@/lib/constants';
import { audioManager } from '@/lib/audioManager';
import { useGeminiVoice, UseGeminiVoiceReturn } from '@/hooks/useGeminiVoice';
import { createAudioWorkletNode, convertInt16ToFloat32 } from '@/lib/audioProcessor';
import { useCallStore, GeminiStatus } from '@/store/useCallStore';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface UseWebRTCOptions {
  roomId: string;
  userName?: string;
  serverUrl?: string;
  useAIVoice?: boolean;
  voice?: string;
}

interface PeerWithPC extends SimplePeerInstance {
  _pc?: RTCPeerConnection;
}

const SPEAKING_ENTER_THRESHOLD = 25;
const SPEAKING_EXIT_THRESHOLD = 15;
const UPDATE_THROTTLE_MS = 100;
const ICE_CONNECTION_TIMEOUT_MS = 30000;

export function useWebRTC({
  roomId,
  userName = 'Guest',
  serverUrl =
    process.env.NEXT_PUBLIC_SIGNALING_URL ||
    process.env.NEXT_PUBLIC_SIGNALING_SERVER ||
    'http://localhost:3001',
  useAIVoice = false,
  voice = 'Puck',
}: UseWebRTCOptions) {
  // State
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const [useAIVoiceState, setUseAIVoiceState] = useState<boolean>(useAIVoice);

  // Sync with call store for Gemini status indicators
  const setGeminiStatus = useCallStore((s) => s.setGeminiStatus);
  const setGeminiError = useCallStore((s) => s.setGeminiError);

  // Persistent stable user ID for Gemini token requirements
  const userIdRef = useRef<string>('');
  if (!userIdRef.current) {
    const cleaned = userName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    userIdRef.current = cleaned || `user_${Math.floor(Math.random() * 10000)}`;
  }

  // Hook for Gemini Voice
  const geminiVoice: UseGeminiVoiceReturn = useGeminiVoice({
    roomId,
    userId: userIdRef.current,
    voice,
    enabled: true,
  });

  // Reference to geminiVoice to decouple callbacks from re-renders
  const geminiVoiceRef = useRef<UseGeminiVoiceReturn>(geminiVoice);
  geminiVoiceRef.current = geminiVoice;

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, SimplePeerInstance>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const iceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Audio nodes
  const aiDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const aiNextPlayTimeRef = useRef<number>(0);
  const processorNodeRef = useRef<AudioNode | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const useAIVoiceRef = useRef<boolean>(useAIVoiceState);
  useAIVoiceRef.current = useAIVoiceState;

  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;

  const analyserRefs = useRef<
    Map<
      string,
      {
        analyser: AnalyserNode;
        source: MediaStreamAudioSourceNode;
        animationFrameId: number;
        isSpeaking: boolean;
        lastUpdateTime: number;
      }
    >
  >(new Map());

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = audioManager.getAudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // Sync Gemini status to Zustand store with strict equality check
  useEffect(() => {
    let targetStatus: GeminiStatus = 'idle';
    let targetError: string | null = null;

    if (geminiVoice.error) {
      targetStatus = 'error';
      targetError = geminiVoice.error;
    } else if (geminiVoice.isConnected) {
      targetStatus = 'ready';
    } else if (useAIVoiceState) {
      targetStatus = 'connecting';
    }

    const currentState = useCallStore.getState();
    if (currentState.geminiStatus !== targetStatus) {
      setGeminiStatus(targetStatus);
    }
    if (currentState.geminiError !== targetError) {
      setGeminiError(targetError);
    }
  }, [geminiVoice.isConnected, geminiVoice.error, useAIVoiceState, setGeminiStatus, setGeminiError]);

  const updateSpeakingState = useCallback((participantId: string, speaking: boolean) => {
    setParticipants((prev) => {
      const target = prev.get(participantId);
      if (!target || target.isSpeaking === speaking) return prev;
      const next = new Map(prev);
      next.set(participantId, { ...target, isSpeaking: speaking });
      return next;
    });
  }, []);

  const setupSpeakingDetection = useCallback(
    (participantId: string, stream: MediaStream) => {
      if (analyserRefs.current.has(participantId)) {
        const existing = analyserRefs.current.get(participantId)!;
        cancelAnimationFrame(existing.animationFrameId);
        try {
          existing.source.disconnect();
          existing.analyser.disconnect();
        } catch {}
        analyserRefs.current.delete(participantId);
      }

      try {
        const audioContext = getAudioContext();
        if (stream.getAudioTracks().length === 0) return;

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const record = {
          analyser,
          source,
          animationFrameId: 0,
          isSpeaking: false,
          lastUpdateTime: 0,
        };

        const detect = () => {
          analyser.getByteTimeDomainData(dataArray);

          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const normalized = (dataArray[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length) * 100;

          const isSelf =
            participantId === socketRef.current?.id || participantId === 'local';
          const isUserMuted = isSelf ? isMutedRef.current : false;

          let targetSpeaking = record.isSpeaking;
          if (isUserMuted) {
            targetSpeaking = false;
          } else if (!record.isSpeaking && rms > SPEAKING_ENTER_THRESHOLD) {
            targetSpeaking = true;
          } else if (record.isSpeaking && rms < SPEAKING_EXIT_THRESHOLD) {
            targetSpeaking = false;
          }

          const now = Date.now();
          if (
            targetSpeaking !== record.isSpeaking &&
            now - record.lastUpdateTime >= UPDATE_THROTTLE_MS
          ) {
            record.isSpeaking = targetSpeaking;
            record.lastUpdateTime = now;
            updateSpeakingState(participantId, targetSpeaking);
          }

          record.animationFrameId = requestAnimationFrame(detect);
        };

        record.animationFrameId = requestAnimationFrame(detect);
        analyserRefs.current.set(participantId, record);
      } catch (err) {
        console.warn(`Failed to setup speaking detection for ${participantId}:`, err);
      }
    },
    [getAudioContext, updateSpeakingState]
  );

  const getOutgoingStream = useCallback((): MediaStream | null => {
    if (useAIVoiceRef.current && aiDestinationRef.current) {
      return aiDestinationRef.current.stream;
    }
    return localStreamRef.current;
  }, []);

  // Pipe Gemini audio chunks into aiDestination stream
  const { onAudioResponse } = geminiVoice;
  useEffect(() => {
    const unsubscribe = onAudioResponse((pcmChunk: ArrayBuffer) => {
      const ctx = getAudioContext();
      if (!ctx || !aiDestinationRef.current) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const int16 = new Int16Array(pcmChunk);
      if (int16.length === 0) return;
      const float32 = convertInt16ToFloat32(int16);

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(aiDestinationRef.current);

      const currentTime = ctx.currentTime;
      const startTime = Math.max(aiNextPlayTimeRef.current, currentTime);
      source.start(startTime);
      aiNextPlayTimeRef.current = startTime + audioBuffer.duration;
    });

    return () => {
      unsubscribe();
    };
  }, [onAudioResponse, getAudioContext]);

  // Stable initializeLocalStream (no geminiVoice dependency)
  const initializeLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      const ctx = getAudioContext();
      if (!aiDestinationRef.current) {
        aiDestinationRef.current = ctx.createMediaStreamDestination();
      }

      if (!processorNodeRef.current) {
        const micSource = ctx.createMediaStreamSource(stream);
        micSourceNodeRef.current = micSource;

        const processor = await createAudioWorkletNode(ctx, (pcm16) => {
          if (useAIVoiceRef.current && !isMutedRef.current && geminiVoiceRef.current?.isConnected) {
            geminiVoiceRef.current.sendAudio(pcm16.buffer as ArrayBuffer);
          }
        });
        processorNodeRef.current = processor;

        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        silentGainRef.current = silentGain;

        micSource.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);
      }

      return stream;
    } catch (err) {
      console.error('Failed to get user media (microphone access):', err);
      return null;
    }
  }, [getAudioContext]);

  const setAIVoice = useCallback(
    (enabled: boolean) => {
      setUseAIVoiceState(enabled);
      useAIVoiceRef.current = enabled;

      if (socketRef.current?.connected) {
        socketRef.current.emit('ai-voice-toggle', { useAIVoice: enabled });
      }

      const ctx = getAudioContext();
      if (!aiDestinationRef.current) {
        aiDestinationRef.current = ctx.createMediaStreamDestination();
      }

      const aiTrack = aiDestinationRef.current.stream.getAudioTracks()[0];
      const micTrack = localStreamRef.current?.getAudioTracks()[0];
      const newTrack = enabled ? aiTrack : micTrack;
      const oldTrack = enabled ? micTrack : aiTrack;

      if (!newTrack) return;

      peersRef.current.forEach((peer) => {
        try {
          const peerWithPc = peer as PeerWithPC;
          const oldStream = enabled ? localStreamRef.current : aiDestinationRef.current?.stream;
          let replaced = false;

          if (oldTrack && oldStream && typeof peerWithPc.replaceTrack === 'function') {
            try {
              peerWithPc.replaceTrack(oldTrack, newTrack, oldStream);
              replaced = true;
            } catch {
              // If simple-peer senderMap does not match the track, fall back to native RTCRtpSender
            }
          }

          if (!replaced) {
            const senders: RTCRtpSender[] = peerWithPc._pc?.getSenders() || [];
            const audioSender = senders.find((s) => s.track?.kind === 'audio');
            if (audioSender) {
              audioSender.replaceTrack(newTrack);
            }
          }
        } catch (err) {
          console.warn('[WebRTC] Failed to hot-swap track on peer:', err);
        }
      });
    },
    [getAudioContext]
  );

  const cleanupPeer = useCallback((peerId: string) => {
    const iceTimer = iceTimersRef.current.get(peerId);
    if (iceTimer) {
      clearTimeout(iceTimer);
      iceTimersRef.current.delete(peerId);
    }

    const peer = peersRef.current.get(peerId);
    if (peer) {
      try {
        peer.destroy();
      } catch {}
      peersRef.current.delete(peerId);
    }

    audioManager.removeRemoteAudio(peerId);

    const analyserRecord = analyserRefs.current.get(peerId);
    if (analyserRecord) {
      cancelAnimationFrame(analyserRecord.animationFrameId);
      try {
        analyserRecord.source.disconnect();
        analyserRecord.analyser.disconnect();
      } catch {}
      analyserRefs.current.delete(peerId);
    }

    setParticipants((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const createPeer = useCallback(
    (targetId: string, initiator: boolean, stream: MediaStream): SimplePeerInstance => {
      if (peersRef.current.has(targetId)) {
        peersRef.current.get(targetId)?.destroy();
        peersRef.current.delete(targetId);
      }

      const outgoingStream = getOutgoingStream() || stream;

      const peer = new SimplePeer({
        initiator,
        stream: outgoingStream,
        trickle: true,
        config: { iceServers: ICE_SERVERS },
      });

      const iceTimer = setTimeout(() => {
        if (!peer.connected && !peer.destroyed) {
          try {
            peer.destroy();
          } catch {}
          if (localStreamRef.current && socketRef.current?.connected) {
            createPeer(targetId, true, localStreamRef.current);
          }
        }
      }, ICE_CONNECTION_TIMEOUT_MS);
      iceTimersRef.current.set(targetId, iceTimer);

      peer.on('signal', (signalData) => {
        if (!socketRef.current?.connected) return;
        socketRef.current.emit('signal', {
          to: targetId,
          payload: signalData,
          type: initiator ? MessageType.OFFER : MessageType.ANSWER,
          roomId,
        });
      });

      peer.on('stream', (remoteStream: MediaStream) => {
        const timer = iceTimersRef.current.get(targetId);
        if (timer) {
          clearTimeout(timer);
          iceTimersRef.current.delete(targetId);
        }

        audioManager.attachRemoteAudio(targetId, remoteStream);

        setParticipants((prev) => {
          const participant = prev.get(targetId);
          if (!participant) return prev;
          const next = new Map(prev);
          next.set(targetId, { ...participant, stream: remoteStream });
          return next;
        });

        setupSpeakingDetection(targetId, remoteStream);
      });

      peer.on('connect', () => {
        const timer = iceTimersRef.current.get(targetId);
        if (timer) {
          clearTimeout(timer);
          iceTimersRef.current.delete(targetId);
        }
      });

      peer.on('error', (err: Error) => {
        console.error(`[WebRTC] Peer error with ${targetId}:`, err);
        cleanupPeer(targetId);
      });

      peer.on('close', () => {
        cleanupPeer(targetId);
      });

      peersRef.current.set(targetId, peer);
      return peer;
    },
    [roomId, setupSpeakingDetection, cleanupPeer, getOutgoingStream]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prevMuted) => {
      const nextMuted = !prevMuted;

      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !nextMuted;
        });
      }

      if (socketRef.current?.connected) {
        socketRef.current.emit('mute-toggle', { isMuted: nextMuted });
      }

      setParticipants((prev) => {
        const selfId = socketRef.current?.id;
        if (!selfId || !prev.has(selfId)) return prev;
        const next = new Map(prev);
        const self = next.get(selfId)!;
        next.set(selfId, {
          ...self,
          isMuted: nextMuted,
          isSpeaking: nextMuted ? false : self.isSpeaking,
        });
        return next;
      });

      return nextMuted;
    });
  }, []);

  // Stable leaveRoom with empty dependencies (no geminiVoice dependency)
  const leaveRoom = useCallback(() => {
    iceTimersRef.current.forEach((timer) => clearTimeout(timer));
    iceTimersRef.current.clear();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    peersRef.current.forEach((peer) => {
      try {
        peer.destroy();
      } catch {}
    });
    peersRef.current.clear();

    audioManager.cleanup();

    analyserRefs.current.forEach((record) => {
      cancelAnimationFrame(record.animationFrameId);
      try {
        record.source.disconnect();
        record.analyser.disconnect();
      } catch {}
    });
    analyserRefs.current.clear();

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    geminiVoiceRef.current?.close();

    setLocalStream(null);
    setParticipants(new Map());
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  useEffect(() => {
    if (!roomId) return;

    let isMounted = true;
    setConnectionStatus('connecting');

    const setupConnection = async () => {
      const stream = await initializeLocalStream();
      if (!isMounted || !stream) {
        if (isMounted) setConnectionStatus('disconnected');
        return;
      }

      let targetUrl = serverUrl;
      const isPrivateLanIp =
        typeof window !== 'undefined' &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
          window.location.hostname
        );

      if (
        isPrivateLanIp &&
        (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1'))
      ) {
        targetUrl = `${window.location.protocol}//${window.location.hostname}:3001`;
      }

      const socket = io(targetUrl, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
      });
      socketRef.current = socket;

      const handleJoin = () => {
        if (!isMounted) return;
        setIsConnected(true);
        setConnectionStatus('connected');

        const selfParticipant: Participant = {
          id: socket.id || 'local',
          name: userName,
          isMuted: isMutedRef.current,
          isSpeaking: false,
          useAIVoice: useAIVoiceRef.current,
          stream,
        };

        setParticipants(new Map([[selfParticipant.id, selfParticipant]]));
        setupSpeakingDetection(selfParticipant.id, stream);

        socket.emit('join-room', {
          roomId,
          userData: {
            name: userName,
            isMuted: isMutedRef.current,
            useAIVoice: useAIVoiceRef.current,
          },
        });
      };

      socket.on('connect', handleJoin);

      socket.io.on('reconnect_attempt', () => {
        if (isMounted) setConnectionStatus('reconnecting');
      });

      socket.io.on('reconnect', () => {
        if (!isMounted) return;
        peersRef.current.forEach((peer) => {
          try {
            peer.destroy();
          } catch {}
        });
        peersRef.current.clear();
        handleJoin();
      });

      socket.io.on('reconnect_failed', () => {
        if (isMounted) setConnectionStatus('disconnected');
      });

      socket.on(
        'room-joined',
        ({
          self,
          existingParticipants,
        }: {
          roomId: string;
          self: Participant;
          existingParticipants: Participant[];
        }) => {
          if (!isMounted) return;

          setParticipants((prev) => {
            const next = new Map(prev);
            if (self?.id) {
              next.set(self.id, {
                ...self,
                stream: localStreamRef.current || undefined,
              });
            }
            existingParticipants.forEach((p) => {
              if (p.id !== socket.id) {
                next.set(p.id, {
                  id: p.id,
                  name: p.name,
                  isMuted: p.isMuted,
                  isSpeaking: false,
                  useAIVoice: p.useAIVoice,
                });
              }
            });
            return next;
          });

          existingParticipants.forEach((p) => {
            if (p.id !== socket.id && localStreamRef.current) {
              createPeer(p.id, true, localStreamRef.current);
            }
          });
        }
      );

      socket.on(
        'user-joined',
        ({ participant }: { participant: Participant }) => {
          if (!isMounted || participant.id === socket.id) return;

          setParticipants((prev) => {
            const next = new Map(prev);
            next.set(participant.id, {
              id: participant.id,
              name: participant.name,
              isMuted: participant.isMuted,
              isSpeaking: false,
              useAIVoice: participant.useAIVoice,
            });
            return next;
          });
        }
      );

      socket.on(
        'signal',
        ({
          from,
          payload,
        }: {
          from: string;
          payload: SimplePeer.SignalData;
          type: string;
        }) => {
          if (!isMounted) return;

          let peer = peersRef.current.get(from);

          if (!peer && localStreamRef.current) {
            peer = createPeer(from, false, localStreamRef.current);
          }

          if (peer && !peer.destroyed) {
            peer.signal(payload);
          }
        }
      );

      socket.on(
        'mute-toggle',
        ({ userId, isMuted: remoteMuted }: { userId: string; isMuted: boolean }) => {
          if (!isMounted) return;

          setParticipants((prev) => {
            const target = prev.get(userId);
            if (!target) return prev;
            const next = new Map(prev);
            next.set(userId, {
              ...target,
              isMuted: remoteMuted,
              isSpeaking: remoteMuted ? false : target.isSpeaking,
            });
            return next;
          });
        }
      );

      socket.on(
        'ai-voice-toggled',
        ({ userId, useAIVoice: remoteAIVoice }: { userId: string; useAIVoice: boolean }) => {
          if (!isMounted) return;

          setParticipants((prev) => {
            const target = prev.get(userId);
            if (!target) return prev;
            const next = new Map(prev);
            next.set(userId, {
              ...target,
              useAIVoice: remoteAIVoice,
            });
            return next;
          });
        }
      );

      socket.on(
        'participant-updated',
        ({
          userId,
          useAIVoice: remoteAIVoice,
          participant,
        }: {
          userId: string;
          useAIVoice: boolean;
          participant: Partial<Participant>;
        }) => {
          if (!isMounted) return;

          setParticipants((prev) => {
            const target = prev.get(userId);
            if (!target) return prev;
            const next = new Map(prev);
            next.set(userId, {
              ...target,
              ...participant,
              useAIVoice: remoteAIVoice,
            });
            return next;
          });
        }
      );

      socket.on('user-left', ({ userId }: { userId: string }) => {
        if (!isMounted) return;
        cleanupPeer(userId);
      });

      socket.on('disconnect', (reason) => {
        if (!isMounted) return;
        setIsConnected(false);
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          setConnectionStatus('disconnected');
        } else {
          setConnectionStatus('reconnecting');
        }
      });

      socket.on('connect_error', () => {
        if (!isMounted) return;
        setConnectionStatus('reconnecting');
      });
    };

    setupConnection();

    return () => {
      isMounted = false;
      leaveRoom();
    };
  }, [
    roomId,
    userName,
    serverUrl,
    initializeLocalStream,
    createPeer,
    cleanupPeer,
    setupSpeakingDetection,
    leaveRoom,
  ]);

  return {
    participants,
    localStream,
    isMuted,
    isConnected,
    connectionStatus,
    toggleMute,
    leaveRoom,
    useAIVoice: useAIVoiceState,
    setAIVoice,
    geminiVoice,
  };
}

export default useWebRTC;
