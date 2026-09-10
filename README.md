# VoiceLink (webAccentchanger) 🎙️⚡

> A professional, real-time WebRTC voice calling web application built with **Next.js 14 (App Router + TypeScript + Tailwind CSS)**, **SimplePeer**, **Socket.IO signaling**, and **Zustand**.

---

## 🌟 Key Features

- **P2P Encrypted Audio**: Low-latency mesh audio streaming via WebRTC (`simple-peer`).
- **Real-time Active Speaker Detection**: Time-domain RMS analysis using Web Audio API (`AnalyserNode`) with hysteresis (>25 enter, <15 exit) and smooth animated gradient rings.
- **Glassmorphism Dark UI**: Built with Tailwind CSS and Framer Motion transitions (`zinc-950` dark aesthetic).
- **Controls & Shortcuts**:
  - Big circular mute button (<kbd>M</kbd>) with red glow indicator.
  - Instant leave button (<kbd>L</kbd>) with clean resource teardown.
  - Master playback volume control slider.
  - One-click invite link copying with sonner toast notifications.
- **Production Signaling Server**:
  - Node.js + Socket.IO with CORS, rate limiting, and 60-second empty room garbage collection.
  - Structured logging with `pino`.
  - Configurable STUN/TURN server traversal for NAT traversal.
  - Graceful shutdown handling (`SIGTERM`/`SIGINT`).
- **Docker & Compose Ready**: Multi-stage Docker builds for both the Next.js frontend and the signaling server.

---

## 🏗️ Architecture

```
                                  ┌───────────────────────────────┐
                                  │   Socket.IO Signaling Server  │
                                  │         (Port 3001)           │
                                  └───────────────▲───────────────┘
                                                  │
                                  SDP Offers / Answers / ICE
                                                  │
                                                  ▼
   ┌────────────────────────┐         Direct P2P Audio         ┌────────────────────────┐
   │    User A (Browser)    │ ◄──────────────────────────────► │    User B (Browser)    │
   │  Next.js 14 (Port 3000)│         (WebRTC Mesh)            │  Next.js 14 (Port 3000)│
   └────────────────────────┘                                  └────────────────────────┘
```

---

## 🚀 Quick Start (Local Development)

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/kartikgetitnow-spec/webAccentchanger.git
cd webAccentchanger

# Install web app dependencies
npm install

# Install signaling server dependencies
cd server && npm install && cd ..
```

### 2. Configure Environment

Frontend (`.env.local`):
```bash
NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001
```

Signaling server (`server/.env`):
```bash
PORT=3001
CLIENT_URL=http://localhost:3000
LOG_LEVEL=info
MAX_PARTICIPANTS=10

# Optional TURN server (for cellular / strict NAT traversal):
TURN_URL=
TURN_USERNAME=
TURN_CREDENTIAL=
```

### 3. Run Development Servers

In terminal 1 (Signaling Server):
```bash
npm run server
```

In terminal 2 (Next.js Web App):
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in two browser tabs or devices on the same network to test voice calling!

---

## 🐳 Docker Deployment

Run both the Next.js app and the signaling server together with Docker Compose:

```bash
docker compose up --build
```

---

## 🌐 Production Deployment

- **Next.js App**: Deploy to [Vercel](https://vercel.com). Set `NEXT_PUBLIC_SIGNALING_URL` to your production signaling server URL.
- **Signaling Server**: Deploy to [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io) from the `/server` folder.

---

## 📝 License

MIT
