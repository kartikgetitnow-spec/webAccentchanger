'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, User, Radio, Sparkles } from 'lucide-react';
import { Participant } from '@/lib/types';

interface ParticipantListProps {
  participants: Participant[];
  currentUserId?: string;
  onCopyRoomLink?: () => void;
}

const AVATAR_GRADIENTS = [
  'from-indigo-600 via-indigo-500 to-purple-600',
  'from-cyan-600 via-teal-500 to-blue-600',
  'from-emerald-600 via-emerald-500 to-teal-600',
  'from-amber-600 via-amber-500 to-orange-600',
  'from-rose-600 via-pink-500 to-purple-600',
  'from-blue-600 via-indigo-500 to-violet-600',
];

function getAvatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ParticipantList({
  participants,
  currentUserId,
  onCopyRoomLink,
}: ParticipantListProps) {
  // Sort: local user first, then others alphabetically
  const sortedParticipants = [...participants].sort((a, b) => {
    const aIsSelf = a.id === currentUserId || a.id === 'local';
    const bIsSelf = b.id === currentUserId || b.id === 'local';
    if (aIsSelf && !bIsSelf) return -1;
    if (!aIsSelf && bIsSelf) return 1;
    return a.name.localeCompare(b.name);
  });

  const otherParticipantsCount = participants.filter(
    (p) => p.id !== currentUserId && p.id !== 'local'
  ).length;

  return (
    <div className="w-full flex-1 flex flex-col justify-start" role="region" aria-label="Participants list">
      {/* Participants Grid */}
      <motion.div
        layout
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 w-full"
        role="list"
      >
        <AnimatePresence mode="popLayout">
          {sortedParticipants.map((participant) => {
            const isSelf = participant.id === currentUserId || participant.id === 'local';
            const isSpeaking = participant.isSpeaking && !participant.isMuted;
            const gradient = getAvatarGradient(participant.id);

            return (
              <motion.div
                key={participant.id}
                layout
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                className={`relative flex flex-col items-center justify-between p-6 rounded-2xl transition-all duration-300 backdrop-blur-xl border ${
                  isSpeaking
                    ? 'bg-zinc-900/80 border-emerald-500/70 shadow-[0_0_30px_rgba(16,185,129,0.3)] ring-2 ring-emerald-400/40'
                    : 'bg-zinc-900/50 border-white/10 hover:border-white/20'
                }`}
                role="listitem"
                aria-label={`${participant.name}${isSelf ? ' (You)' : ''}, ${
                  participant.isMuted ? 'Muted' : isSpeaking ? 'Speaking' : 'Connected'
                }`}
              >
                {/* Status pill top-right */}
                <div className="absolute top-4 right-4 flex items-center gap-1.5">
                  {participant.useAIVoice && (
                    <span
                      className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full border border-indigo-500/40 text-[10px] font-semibold flex items-center gap-1 shadow-[0_0_8px_rgba(99,102,241,0.25)]"
                      title="AI Voice enabled"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                      AI
                    </span>
                  )}
                  {participant.isMuted ? (
                    <span
                      className="p-1.5 bg-red-500/15 text-red-400 rounded-full border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                      title="Participant muted"
                    >
                      <MicOff className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span
                      className={`p-1.5 rounded-full border ${
                        isSpeaking
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60'
                      }`}
                      title={isSpeaking ? 'Speaking' : 'Microphone unmuted'}
                    >
                      <Mic className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>

                {/* Avatar with speaking ring & waveform */}
                <div className="relative my-4 flex items-center justify-center">
                  {/* Outer animated gradient glow when speaking */}
                  {isSpeaking && (
                    <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-emerald-500 to-green-400 opacity-60 blur-md animate-pulse" />
                  )}

                  {/* Gradient animated border wrapper */}
                  <div
                    className={`relative p-1 rounded-full transition-all duration-300 ${
                      isSpeaking
                        ? 'bg-gradient-to-tr from-emerald-400 via-green-400 to-teal-300 shadow-[0_0_20px_rgba(16,185,129,0.5)] scale-105'
                        : 'bg-transparent'
                    }`}
                  >
                    <div
                      className={`w-24 h-24 rounded-full bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-bold text-2xl shadow-xl select-none ${
                        !isSpeaking && 'ring-2 ring-zinc-700/60'
                      }`}
                    >
                      {getInitials(participant.name)}
                    </div>
                  </div>
                </div>

                {/* Participant name & label */}
                <div className="text-center w-full mt-2">
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="text-base font-semibold text-zinc-100 truncate max-w-[150px]">
                      {participant.name}
                    </h3>
                    {isSelf && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        You
                      </span>
                    )}
                  </div>

                  {/* Dynamic speaking waveform / status */}
                  <div className="mt-2 h-5 flex items-center justify-center">
                    {participant.isMuted ? (
                      <span className="text-xs text-zinc-500 flex items-center gap-1 font-medium">
                        Muted
                      </span>
                    ) : isSpeaking ? (
                      <div className="flex items-center gap-1">
                        <span className="w-1 h-3.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1 h-5 bg-emerald-400 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1 h-2.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:300ms]" />
                        <span className="w-1 h-4 bg-emerald-400 rounded-full animate-bounce [animation-delay:450ms]" />
                        <span className="text-xs text-emerald-400 font-semibold ml-1.5">
                          Speaking
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500 flex items-center gap-1.5 font-medium">
                        <Radio className="w-3 h-3 text-zinc-600" />
                        Connected
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* Empty State when waiting for others */}
      {otherParticipantsCount === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 text-center max-w-lg mx-auto w-full backdrop-blur-md"
        >
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-3 ring-1 ring-white/10">
            <User className="w-6 h-6 animate-pulse text-indigo-400" />
          </div>
          <h4 className="text-base font-semibold text-zinc-200">
            Waiting for others to join...
          </h4>
          <p className="text-sm text-zinc-500 mt-1 max-w-sm">
            Share this room link with your peers or teammates to start the voice call.
          </p>
          {onCopyRoomLink && (
            <button
              onClick={onCopyRoomLink}
              className="mt-4 px-4 py-2 text-xs font-semibold text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Copy Invitation Link
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
