'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Link as LinkIcon,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Users,
} from 'lucide-react';

interface AudioControlsProps {
  isMuted: boolean;
  participantCount: number;
  onToggleMute: () => void;
  onLeaveRoom: () => void;
  onCopyInviteLink?: () => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
}

export default function AudioControls({
  isMuted,
  participantCount,
  onToggleMute,
  onLeaveRoom,
  onCopyInviteLink,
  volume = 100,
  onVolumeChange,
}: AudioControlsProps) {
  const [copied, setCopied] = useState(false);
  const [localVolume, setLocalVolume] = useState(volume);

  useEffect(() => {
    setLocalVolume(volume);
  }, [volume]);

  // Keyboard shortcuts: M = mute, L = leave
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        onToggleMute();
      } else if (key === 'l') {
        e.preventDefault();
        onLeaveRoom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleMute, onLeaveRoom]);

  const handleCopy = useCallback(() => {
    if (onCopyInviteLink) {
      onCopyInviteLink();
    } else {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopyInviteLink]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Number(e.target.value);
    setLocalVolume(newVol);
    if (onVolumeChange) {
      onVolumeChange(newVol);
    }
  };

  return (
    <footer
      className="w-full bg-zinc-950/80 backdrop-blur-2xl border-t border-white/10 px-4 sm:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4 z-30 shadow-2xl"
      role="toolbar"
      aria-label="Call controls"
    >
      {/* Left section: Participants counter & Copy invite */}
      <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
        <div
          className="flex items-center gap-2 px-3.5 py-1.5 bg-zinc-900/80 rounded-full border border-white/10 text-zinc-300 text-xs sm:text-sm font-medium shadow-sm"
          aria-live="polite"
        >
          <Users className="w-4 h-4 text-indigo-400" />
          <span>
            {participantCount} {participantCount === 1 ? 'user' : 'users'}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-zinc-900/80 hover:bg-zinc-850 text-zinc-300 hover:text-white border border-white/10 rounded-full text-xs sm:text-sm font-medium transition shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          title="Copy room invitation link"
          aria-label="Copy room invitation link"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <LinkIcon className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" />
              <span>Copy Invite</span>
              <Copy className="w-3 h-3 text-zinc-500 hidden sm:inline" />
            </>
          )}
        </button>
      </div>

      {/* Center section: Big action buttons */}
      <div className="flex items-center gap-5 sm:gap-7">
        {/* Big circular Mute/Unmute button */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onToggleMute}
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 ${
              isMuted
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_25px_rgba(239,68,68,0.5)] ring-4 ring-red-600/30'
                : 'bg-zinc-800/90 hover:bg-zinc-750 text-zinc-100 ring-2 ring-white/10 hover:ring-white/20 shadow-lg'
            }`}
            title={isMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={isMuted}
          >
            {isMuted ? (
              <MicOff className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            ) : (
              <Mic className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400" />
            )}
          </button>
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">
            {isMuted ? 'Muted' : 'Mic On'}
          </span>
        </div>

        {/* Big circular Leave call button */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onLeaveRoom}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-600/90 hover:bg-red-600 text-white flex items-center justify-center transition-all duration-200 shadow-xl shadow-red-600/25 ring-4 ring-red-600/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
            title="Leave call (L)"
            aria-label="Leave call"
          >
            <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
          <span className="text-[10px] uppercase font-bold tracking-wider text-red-400">
            Leave
          </span>
        </div>
      </div>

      {/* Right section: Playback volume slider & keyboard shortcut legend */}
      <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
        {/* Playback Volume Slider */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 bg-zinc-900/80 rounded-full border border-white/10 shadow-sm">
          <button
            onClick={() => {
              const newVol = localVolume > 0 ? 0 : 100;
              setLocalVolume(newVol);
              if (onVolumeChange) onVolumeChange(newVol);
            }}
            className="text-zinc-400 hover:text-zinc-200 transition focus-visible:outline-none"
            title={localVolume === 0 ? 'Unmute playback' : 'Mute playback'}
            aria-label={localVolume === 0 ? 'Unmute playback' : 'Mute playback'}
          >
            {localVolume === 0 ? (
              <VolumeX className="w-4 h-4 text-red-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-zinc-300" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={localVolume}
            onChange={handleSliderChange}
            className="w-20 sm:w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
            aria-label="Playback volume slider"
            title={`Playback Volume: ${localVolume}%`}
          />
          <span className="text-[11px] font-mono text-zinc-400 w-7 text-right">
            {localVolume}%
          </span>
        </div>

        {/* Keyboard shortcut legend */}
        <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
          <kbd className="px-1.5 py-0.5 bg-zinc-850 rounded border border-zinc-700 text-zinc-300">
            M
          </kbd>
          <span>Mute</span>
          <span className="text-zinc-700">•</span>
          <kbd className="px-1.5 py-0.5 bg-zinc-850 rounded border border-zinc-700 text-zinc-300">
            L
          </kbd>
          <span>Leave</span>
        </div>
      </div>
    </footer>
  );
}
