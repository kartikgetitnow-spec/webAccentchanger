'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import VoiceChat from '@/components/VoiceChat';

function RoomSkeleton() {
  return (
    <div className="h-screen w-full bg-zinc-950 flex flex-col justify-between animate-pulse">
      {/* Header skeleton */}
      <header className="w-full bg-zinc-900/60 border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-24 h-6 bg-zinc-800 rounded-md" />
          <div className="w-16 h-6 bg-zinc-800/60 rounded-md" />
        </div>
        <div className="w-24 h-6 bg-zinc-800 rounded-full" />
      </header>

      {/* Main skeleton grid */}
      <main className="flex-1 px-6 py-8 flex flex-col items-center">
        <div className="max-w-6xl w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-56 bg-slate-900/40 border border-slate-800/60 rounded-2xl flex flex-col items-center justify-center p-6 gap-4"
            >
              <div className="w-20 h-20 rounded-full bg-slate-800" />
              <div className="w-28 h-4 bg-slate-800 rounded" />
              <div className="w-16 h-3 bg-slate-800/60 rounded" />
            </div>
          ))}
        </div>
      </main>

      {/* Footer skeleton */}
      <footer className="w-full bg-slate-900/60 border-t border-slate-800/80 px-6 py-4 flex items-center justify-between">
        <div className="w-28 h-8 bg-slate-800 rounded-full" />
        <div className="flex gap-4">
          <div className="w-24 h-10 bg-slate-800 rounded-full" />
          <div className="w-24 h-10 bg-slate-800 rounded-full" />
        </div>
        <div className="w-20 h-4 bg-slate-800 rounded" />
      </footer>
    </div>
  );
}

function RoomContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const roomId = (params?.roomId as string) || '';
  const name = searchParams.get('name');

  useEffect(() => {
    if (!name || !name.trim()) {
      router.replace('/');
    }
  }, [name, router]);

  if (!name || !name.trim() || !roomId) {
    return <RoomSkeleton />;
  }

  return <VoiceChat roomId={roomId} userName={name.trim()} />;
}

export default function RoomPage() {
  return (
    <Suspense fallback={<RoomSkeleton />}>
      <RoomContent />
    </Suspense>
  );
}
