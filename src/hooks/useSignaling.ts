'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Participant, MessageType } from '@/lib/types';
import SimplePeer from 'simple-peer';

interface UseSignalingOptions {
  serverUrl?: string;
  autoConnect?: boolean;
}

export function useSignaling(options: UseSignalingOptions = {}) {
  const {
    serverUrl =
      process.env.NEXT_PUBLIC_SIGNALING_URL ||
      process.env.NEXT_PUBLIC_SIGNALING_SERVER ||
      'http://localhost:3001',
    autoConnect = false,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [socketId, setSocketId] = useState<string | null>(null);

  // Connect to the signaling server
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;

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
    });

    socket.on('connect', () => {
      setIsConnected(true);
      setSocketId(socket.id || null);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setSocketId(null);
    });

    socketRef.current = socket;
    return socket;
  }, [serverUrl]);

  // Join a room with user data
  const joinRoom = useCallback(
    (roomId: string, userData?: Partial<Participant>) => {
      let socket = socketRef.current;
      if (!socket || !socket.connected) {
        socket = connect();
      }
      socket.emit('join-room', { roomId, userData });
    },
    [connect]
  );

  // Leave the current room and disconnect
  const leaveRoom = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setSocketId(null);
    }
  }, []);

  // Send WebRTC signaling message
  const sendSignal = useCallback(
    (to: string, payload: unknown, type: MessageType, roomId: string) => {
      if (!socketRef.current?.connected) return;
      socketRef.current.emit('signal', {
        to,
        payload,
        type,
        roomId,
      });
    },
    []
  );

  // Emit mute toggle status
  const sendMuteToggle = useCallback((isMuted: boolean) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('mute-toggle', { isMuted });
  }, []);

  // Listener registrations
  const onRoomJoined = useCallback(
    (
      callback: (data: {
        roomId: string;
        self: Participant;
        existingParticipants: Participant[];
      }) => void
    ) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on('room-joined', callback);
      return () => {
        socket.off('room-joined', callback);
      };
    },
    []
  );

  const onUserJoined = useCallback(
    (callback: (data: { participant: Participant }) => void) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on('user-joined', callback);
      return () => {
        socket.off('user-joined', callback);
      };
    },
    []
  );

  const onSignal = useCallback(
    (
      callback: (data: {
        from: string;
        payload: SimplePeer.SignalData;
        type: MessageType;
        userData?: Partial<Participant>;
      }) => void
    ) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on('signal', callback);
      return () => {
        socket.off('signal', callback);
      };
    },
    []
  );

  const onUserLeft = useCallback(
    (callback: (data: { userId: string }) => void) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on('user-left', callback);
      return () => {
        socket.off('user-left', callback);
      };
    },
    []
  );

  const onMuteToggle = useCallback(
    (callback: (data: { userId: string; isMuted: boolean }) => void) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on('mute-toggle', callback);
      return () => {
        socket.off('mute-toggle', callback);
      };
    },
    []
  );

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [autoConnect, connect]);

  return {
    socket: socketRef.current,
    socketId,
    isConnected,
    connect,
    joinRoom,
    leaveRoom,
    sendSignal,
    sendMuteToggle,
    onRoomJoined,
    onUserJoined,
    onSignal,
    onUserLeft,
    onMuteToggle,
  };
}
