'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Check, Shield } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useCallStore } from '@/store/useCallStore';
import { audioManager } from '@/lib/audioManager';
import ParticipantList from '@/components/ParticipantList';
import AudioControls from '@/components/AudioControls';

interface VoiceChatProps {
  roomId: string;
  userName: string;
}

export default function VoiceChat({ roomId, userName }: VoiceChatProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  // Selected Zustand slice to prevent re-render feedback loops
  const masterVolume = useCallStore((state) => state.masterVolume);
  const setMasterVolume = useCallStore((state) => state.setMasterVolume);
  const resetCallStore = useCallStore((state) => state.reset);

  const {
    participants,
    isMuted,
    connectionStatus,
    toggleMute,
    leaveRoom,
  } = useWebRTC({
    roomId,
    userName,
  });

  // Memoize participants list to prevent reference instability
  const participantsList = useMemo(
    () => Array.from(participants.values()),
    [participants]
  );

  // Synchronize state into Zustand store without triggering re-render cascades
  useEffect(() => {
    useCallStore.setState({
      roomId,
      participants: participantsList,
      isMuted,
      isConnected: connectionStatus === 'connected',
      connectionStatus,
    });
  }, [roomId, participantsList, isMuted, connectionStatus]);

  // Toast notifications on connection state changes
  useEffect(() => {
    if (connectionStatus === 'reconnecting') {
      toast.warning('Connection lost. Reconnecting to voice server...');
    } else if (connectionStatus === 'disconnected') {
      toast.error('Disconnected from voice server.');
    } else if (connectionStatus === 'connected') {
      toast.success('Connected to voice room!');
    }
  }, [connectionStatus]);

  // Handle master playback volume changes
  const handleVolumeChange = useCallback(
    (volume: number) => {
      setMasterVolume(volume);
      audioManager.setAllVolume(volume);
    },
    [setMasterVolume]
  );

  // Copy room link to clipboard
  const handleCopyLink = useCallback(async () => {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Room link copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Failed to copy room link');
    }
  }, []);

  // Leave room and redirect
  const handleLeaveRoom = useCallback(() => {
    leaveRoom();
    resetCallStore();
    audioManager.cleanup();
    toast.info('You left the room.');
    router.push('/');
  }, [leaveRoom, resetCallStore, router]);

  return (
    <div className="h-screen w-full bg-zinc-950 text-slate-100 flex flex-col justify-between overflow-hidden relative selection:bg-indigo-500 selection:text-white">
      {/* Ambient background glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="w-full bg-zinc-950/70 backdrop-blur-2xl border-b border-white/10 px-6 py-4 flex items-center justify-between z-20 shadow-md">
        {/* Left: App title & Room ID badge */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
              VoiceLink
            </span>
            <span className="text-zinc-700 font-light">/</span>
            <span className="text-xs font-semibold text-zinc-300 font-mono bg-zinc-900/90 px-3 py-1 rounded-lg border border-white/10 shadow-sm">
              {roomId}
            </span>
          </div>

          {/* Copy Link Button */}
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900/80 hover:bg-zinc-850 border border-white/10 rounded-lg transition shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            title="Copy invitation link"
            aria-label="Copy invitation link"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>Copy Link</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Encryption & Connection Status Badge */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-900/60 px-3 py-1 rounded-full border border-white/5">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>P2P Encrypted</span>
          </div>

          {/* Connection Status Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400 animate-pulse'
                  : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-red-400'
              }`}
            />
            <span className="capitalize">{connectionStatus}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-8 flex flex-col items-center relative z-10">
        <div className="max-w-6xl w-full flex-1 flex flex-col">
          <ParticipantList
            participants={participantsList}
            onCopyRoomLink={handleCopyLink}
          />
        </div>
      </main>

      {/* Footer Controls */}
      <AudioControls
        isMuted={isMuted}
        participantCount={participantsList.length}
        onToggleMute={toggleMute}
        onLeaveRoom={handleLeaveRoom}
        onCopyInviteLink={handleCopyLink}
        volume={masterVolume}
        onVolumeChange={handleVolumeChange}
      />
    </div>
  );
}
