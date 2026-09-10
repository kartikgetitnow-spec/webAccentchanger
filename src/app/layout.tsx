import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'VoiceLink — Real-time WebRTC Voice Calling',
  description:
    'Ultra-low latency peer-to-peer WebRTC voice rooms with active speaker detection and crystal clear sound.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-slate-100 min-h-screen selection:bg-indigo-500 selection:text-white`}
      >
        {children}
        <Toaster richColors theme="dark" position="top-center" closeButton />
      </body>
    </html>
  );
}
