'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Mic, Volume2, AlertCircle, CheckCircle2, Loader2, Wand2 } from 'lucide-react';
import { useVoiceStore } from '@/store/useVoiceStore';
import { useCallStore } from '@/store/useCallStore';

const AVAILABLE_VOICES = [
  { id: 'Puck', label: 'Puck', description: 'Energetic, playful & expressive' },
  { id: 'Charon', label: 'Charon', description: 'Deep, calm & authoritative' },
  { id: 'Kore', label: 'Kore', description: 'Warm, gentle & clear' },
  { id: 'Fenrir', label: 'Fenrir', description: 'Bold, resonant & intense' },
  { id: 'Aoede', label: 'Aoede', description: 'Melodic, dynamic & bright' },
];

interface AIVoicePanelProps {
  onToggleAIVoice?: (enabled: boolean) => void;
  className?: string;
}

export const AIVoicePanel: React.FC<AIVoicePanelProps> = ({
  onToggleAIVoice,
  className = '',
}) => {
  const { useAIVoice, selectedVoice, setUseAIVoice, setSelectedVoice } = useVoiceStore();
  const { geminiStatus, geminiError } = useCallStore();
  const [isPreviewing, setIsPreviewing] = useState(false);

  const handleToggle = () => {
    const nextVal = !useAIVoice;
    setUseAIVoice(nextVal);
    onToggleAIVoice?.(nextVal);
  };

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVoice(e.target.value);
  };

  const handlePreview = () => {
    if (typeof window === 'undefined') return;
    setIsPreviewing(true);

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);

      setTimeout(() => {
        setIsPreviewing(false);
        ctx.close().catch(() => {});
      }, 400);
    } catch {
      setIsPreviewing(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-4 shadow-xl backdrop-blur-md transition-all ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Title & Icon */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-100">AI Voice Transformation</span>
              {/* Badge */}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                  useAIVoice
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-800/80 text-zinc-400'
                }`}
              >
                {useAIVoice ? 'ON' : 'OFF'}
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Transform your speech in real time with Google Gemini Live
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          type="button"
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
            useAIVoice ? 'bg-indigo-600' : 'bg-zinc-700'
          }`}
          role="switch"
          aria-checked={useAIVoice}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              useAIVoice ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Expanded Controls when Enabled */}
      <AnimatePresence>
        {useAIVoice && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 pt-3 border-t border-zinc-800/60 flex flex-col gap-3"
          >
            {/* Status Indicator */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Gemini Live Status:</span>
              <div className="flex items-center gap-1.5 font-medium">
                {geminiStatus === 'ready' && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Connected & Ready
                  </span>
                )}
                {geminiStatus === 'connecting' && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Connecting to Gemini...
                  </span>
                )}
                {geminiStatus === 'error' && (
                  <span className="flex items-center gap-1 text-rose-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Connection Error
                  </span>
                )}
                {geminiStatus === 'idle' && (
                  <span className="text-zinc-500">Ready to Stream</span>
                )}
              </div>
            </div>

            {/* AI Latency & Headphones Advisory */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-indigo-400" />
              <span>
                AI voice round-trip has ~300–800ms latency. Please wear headphones to avoid audio feedback.
              </span>
            </div>

            {/* Error Message if any */}
            {geminiError && (
              <p className="text-[11px] text-rose-400/90 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
                {geminiError}
              </p>
            )}

            {/* Voice Dropdown and Preview */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-2 items-center">
              <div className="relative">
                <select
                  value={selectedVoice}
                  onChange={handleVoiceChange}
                  className="w-full appearance-none rounded-xl border border-zinc-700/80 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {AVAILABLE_VOICES.map((v) => (
                    <option key={v.id} value={v.id} className="bg-zinc-800 text-zinc-100">
                      {v.label} — {v.description}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handlePreview}
                disabled={isPreviewing}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700/80 hover:text-white transition-colors disabled:opacity-50"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span>{isPreviewing ? 'Testing...' : 'Test Tone'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AIVoicePanel;
