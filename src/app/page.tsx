'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Mic, Users, ArrowRight, Sparkles, Volume2, Shield } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [nameError, setNameError] = useState('');
  const [roomError, setRoomError] = useState('');

  const generateRandomRoom = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const generated = `room-${code}`;
    setRoomId(generated);
    setRoomError('');
  };

  const validate = (): boolean => {
    let isValid = true;

    if (!name.trim()) {
      setNameError('Please enter your display name');
      isValid = false;
    } else {
      setNameError('');
    }

    const trimmedRoom = roomId.trim();
    if (!trimmedRoom) {
      setRoomError('Please enter or generate a room ID');
      isValid = false;
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedRoom)) {
      setRoomError('Room ID can only contain letters, numbers, and dashes');
      isValid = false;
    } else {
      setRoomError('');
    }

    return isValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const trimmedName = encodeURIComponent(name.trim());
    const trimmedRoom = encodeURIComponent(roomId.trim());
    router.push(`/room/${trimmedRoom}?name=${trimmedName}`);
  };

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-slate-100 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden selection:bg-indigo-500 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Animated Card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md bg-zinc-900/60 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-8 relative z-10"
      >
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 via-sky-400 to-emerald-400 flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-4 ring-1 ring-white/20">
            <Mic className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            VoiceLink
          </h1>
          <p className="text-sm text-zinc-400 mt-2">
            Real-time peer-to-peer WebRTC voice calling
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Display Name input */}
          <div>
            <label
              htmlFor="display-name"
              className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2"
            >
              Your Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                <Users className="w-4 h-4" />
              </div>
              <input
                id="display-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError('');
                }}
                placeholder="e.g. Sarah Connor"
                className={`w-full bg-zinc-950/70 border ${
                  nameError
                    ? 'border-red-500/80 focus-visible:ring-red-500'
                    : 'border-white/10 focus-visible:border-indigo-500 focus-visible:ring-indigo-500'
                } rounded-xl pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 text-sm focus-visible:outline-none focus-visible:ring-2 transition shadow-inner`}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'name-error' : undefined}
              />
            </div>
            {nameError && (
              <p id="name-error" className="text-xs text-red-400 mt-1.5 font-medium">
                {nameError}
              </p>
            )}
          </div>

          {/* Room ID input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label
                htmlFor="room-id"
                className="block text-xs font-bold uppercase tracking-wider text-zinc-400"
              >
                Room ID
              </label>
              <button
                type="button"
                onClick={generateRandomRoom}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition focus-visible:outline-none focus-visible:underline"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate random
              </button>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                <Mic className="w-4 h-4" />
              </div>
              <input
                id="room-id"
                type="text"
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  if (roomError) setRoomError('');
                }}
                placeholder="e.g. dev-sync-room"
                className={`w-full bg-zinc-950/70 border ${
                  roomError
                    ? 'border-red-500/80 focus-visible:ring-red-500'
                    : 'border-white/10 focus-visible:border-indigo-500 focus-visible:ring-indigo-500'
                } rounded-xl pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 text-sm focus-visible:outline-none focus-visible:ring-2 transition shadow-inner`}
                aria-invalid={Boolean(roomError)}
                aria-describedby={roomError ? 'room-error' : undefined}
              />
            </div>
            {roomError && (
              <p id="room-error" className="text-xs text-red-400 mt-1.5 font-medium">
                {roomError}
              </p>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="w-full mt-3 bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 text-white font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span>Join Room</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Feature badges */}
        <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <span>Active Speaker Ring</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-400" />
            <span>P2P WebRTC Audio</span>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
