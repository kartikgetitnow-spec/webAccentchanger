'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import SimplePeer, { Instance as SimplePeerInstance } from 'simple-peer';
import { Participant, MessageType } from '@/lib/types';
import { ICE_SERVERS, AUDIO_CONSTRAINTS } from '@/lib/constants';
import { audioManager } from '@/lib/audioManager';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface UseWebRTCOptions {
  roomId: string;
  userName?: string;
  serverUrl?: string;
}

// Speaking detection thresholds (hysteresis)
const SPEAKING_ENTER_THRESHOLD = 25; // Enter speaking above this RMS
const SPEAKING_EXIT_THRESHOLD = 15; // Exit speaking below this RMS
const UPDATE_THROTTLE_MS = 100; // 100ms throttle on state updates
const ICE_CONNECTION_TIMEOUT_MS = 30000; // 30s ICE fallback timer

export function useWebRTC({
  roomId,
  userName = 'Guest',
  serverUrl =
    process.env.NEXT_PUBLIC_SIGNALING_URL ||
    process.env.NEXT_PUBLIC_SIGNALING_SERVER ||
    'http://localhost:3001',
}: UseWebRTCOptions) {
  // State
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, SimplePeerInstance>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const iceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

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

  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;

  const participantsRef = useRef<Map<string, Participant>>(participants);
  participantsRef.current = participants;

  // AudioContext helper
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = audioManager.getAudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // Update participant speaking state
  const updateSpeakingState = useCallback((participantId: string, speaking: boolean) => {
    setParticipants((prev) => {
      const target = prev.get(participantId);
      if (!target || target.isSpeaking === speaking) return prev;
      const next = new Map(prev);
      next.set(participantId, { ...target, isSpeaking: speaking });
      return next;
    });
  }, []);

  // Step 13: Speaking Detection Refinement with Time-Domain RMS & Hysteresis
  const setupSpeakingDetection = useCallback(
    (participantId: string, stream: MediaStream) => {
      // Clean up previous detection for this participant
      if (analyserRefs.current.has(participantId)) {
        const existing = analyserRefs.current.get(participantId)!;
        cancelAnimationFrame(existing.animationFrameId);
        try {
          existing.source.disconnect();
          existing.analyser.disconnect();
        } catch {
          // Ignore disconnection error
        }
        analyserRefs.current.delete(participantId);
      }

      try {
        const audioContext = getAudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();

        // Specific configuration as per Step 13
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.fftSize);

        const record = {
          analyser,
          source,
          animationFrameId: 0,
          isSpeaking: false,
          lastUpdateTime: 0,
        };

        const detect = () => {
          // Time-domain RMS volume calculation
          analyser.getByteTimeDomainData(dataArray);

          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const deviation = dataArray[i] - 128;
            sumSquares += deviation * deviation;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);

          const isSelf =
            participantId === socketRef.current?.id || participantId === 'local';
          const isUserMuted = isSelf ? isMutedRef.current : false;

          // Hysteresis logic: enter at > 25, exit at < 15
          let targetSpeaking = record.isSpeaking;
          if (isUserMuted) {
            targetSpeaking = false;
          } else if (!record.isSpeaking && rms > SPEAKING_ENTER_THRESHOLD) {
            targetSpeaking = true;
          } else if (record.isSpeaking && rms < SPEAKING_EXIT_THRESHOLD) {
            targetSpeaking = false;
          }

          // Throttle state updates to 100ms
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

  // Initialize local microphone
  const initializeLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('Failed to get user media (microphone access):', err);
      return null;
    }
  }, []);

  // Cleanup peer helper
  const cleanupPeer = useCallback((peerId: string) => {
    // Clear ICE watchdog
    const iceTimer = iceTimersRef.current.get(peerId);
    if (iceTimer) {
      clearTimeout(iceTimer);
      iceTimersRef.current.delete(peerId);
    }

    // 1. Destroy SimplePeer instance
    const peer = peersRef.current.get(peerId);
    if (peer) {
      try {
        peer.destroy();
      } catch {
        // Ignore destruction errors
      }
      peersRef.current.delete(peerId);
    }

    // 2. Remove audio element via audioManager
    audioManager.removeRemoteAudio(peerId);

    // 3. Clean up analyser and speaking detection
    const analyserRecord = analyserRefs.current.get(peerId);
    if (analyserRecord) {
      cancelAnimationFrame(analyserRecord.animationFrameId);
      try {
        analyserRecord.source.disconnect();
        analyserRecord.analyser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      analyserRefs.current.delete(peerId);
    }

    // 4. Remove participant from state
    setParticipants((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  // Step 14: Create Peer with ICE restart fallback & close handling
  const createPeer = useCallback(
    (targetId: string, initiator: boolean, stream: MediaStream): SimplePeerInstance => {
      // Clear existing peer for this targetId if any
      if (peersRef.current.has(targetId)) {
        peersRef.current.get(targetId)?.destroy();
        peersRef.current.delete(targetId);
      }

      const peer = new SimplePeer({
        initiator,
        stream,
        trickle: true,
        config: { iceServers: ICE_SERVERS },
      });

      // 30s ICE connection fallback watchdog
      const iceTimer = setTimeout(() => {
        if (!peer.connected && !peer.destroyed) {
          console.warn(`[WebRTC] ICE connection timeout with ${targetId}. Retrying peer connection...`);
          try {
            peer.destroy();
          } catch {
            // Ignore
          }
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
        // Clear ICE watchdog once stream begins
        const timer = iceTimersRef.current.get(targetId);
        if (timer) {
          clearTimeout(timer);
          iceTimersRef.current.delete(targetId);
        }

        audioManager.attachRemoteAudio(targetId, remoteStream);

        // Update participant stream in state
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
        console.log(`[WebRTC] Peer connection established with ${targetId}`);
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
        console.log(`[WebRTC] Peer connection closed with ${targetId}. Cleaning up.`);
        cleanupPeer(targetId);
      });

      peersRef.current.set(targetId, peer);
      return peer;
    },
    [roomId, setupSpeakingDetection, cleanupPeer]
  );

  // Toggle local mute
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

  // Leave room and reset
  const leaveRoom = useCallback(() => {
    // Clear all ICE timers
    iceTimersRef.current.forEach((timer) => clearTimeout(timer));
    iceTimersRef.current.clear();

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Destroy all peers
    peersRef.current.forEach((peer) => {
      try {
        peer.destroy();
      } catch {
        // Ignore
      }
    });
    peersRef.current.clear();

    // Cleanup audioManager
    audioManager.cleanup();

    // Cancel all speaking detections
    analyserRefs.current.forEach((record) => {
      cancelAnimationFrame(record.animationFrameId);
      try {
        record.source.disconnect();
        record.analyser.disconnect();
      } catch {
        // Ignore
      }
    });
    analyserRefs.current.clear();

    // Stop local media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Reset states
    setLocalStream(null);
    setParticipants(new Map());
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  // Lifecycle useEffect with Auto-Reconnect & Resilience
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

      // Automatically adapt to host IP if accessed via private LAN IP (e.g. 10.x, 192.168.x)
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

      // Step 14: Socket.IO Auto-reconnect with exponential backoff
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

        // Setup local participant
        const selfParticipant: Participant = {
          id: socket.id || 'local',
          name: userName,
          isMuted: isMutedRef.current,
          isSpeaking: false,
          stream,
        };

        setParticipants(new Map([[selfParticipant.id, selfParticipant]]));
        setupSpeakingDetection(selfParticipant.id, stream);

        // Emit join-room
        socket.emit('join-room', {
          roomId,
          userData: {
            name: userName,
            isMuted: isMutedRef.current,
          },
        });
      };

      socket.on('connect', handleJoin);

      // Reconnect handling: recreate peers upon regaining connection
      socket.io.on('reconnect_attempt', () => {
        if (isMounted) setConnectionStatus('reconnecting');
      });

      socket.io.on('reconnect', () => {
        if (!isMounted) return;
        console.log('[Socket] Reconnected to server. Re-joining room...');
        // Clear old peers
        peersRef.current.forEach((peer) => {
          try {
            peer.destroy();
          } catch {
            // Ignore
          }
        });
        peersRef.current.clear();
        handleJoin();
      });

      socket.io.on('reconnect_failed', () => {
        if (isMounted) setConnectionStatus('disconnected');
      });

      // Handle room-joined
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
                });
              }
            });
            return next;
          });

          // Create offers (initiator = true) to each existing peer
          existingParticipants.forEach((p) => {
            if (p.id !== socket.id && localStreamRef.current) {
              createPeer(p.id, true, localStreamRef.current);
            }
          });
        }
      );

      // Handle user-joined
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
            });
            return next;
          });
        }
      );

      // Handle signal relay
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

          // If no peer exists yet, this is an incoming offer; create peer as receiver
          if (!peer && localStreamRef.current) {
            peer = createPeer(from, false, localStreamRef.current);
          }

          if (peer && !peer.destroyed) {
            peer.signal(payload);
          }
        }
      );

      // Handle mute-toggle
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

      // Handle user-left
      socket.on('user-left', ({ userId }: { userId: string }) => {
        if (!isMounted) return;
        cleanupPeer(userId);
      });

      // Handle disconnect
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
  };
}

export default useWebRTC;
