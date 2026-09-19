const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pino = require('pino');
require('dotenv').config();

const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
  level: process.env.LOG_LEVEL || 'info',
});

const PORT = parseInt(process.env.PORT || '3001', 10);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const MAX_PARTICIPANTS = parseInt(process.env.MAX_PARTICIPANTS || '10', 10);
const EMPTY_ROOM_TIMEOUT_MS = 60000; // 60s cleanup delay

// Configurable ICE/TURN servers from environment
function getIceServers() {
  const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
  ];

  if (process.env.TURN_URL) {
    const turn = {
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    };
    return [...stunServers, turn];
  }

  // Fallback to Metered Open Relay TURN for testing mobile NAT traversal
  const openRelayTurn = [
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  return [...stunServers, ...openRelayTurn];
}

const corsMiddleware = cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
});

const server = http.createServer((req, res) => {
  corsMiddleware(req, res, () => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          roomsCount: rooms.size,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // ICE servers configuration endpoint
    if (req.method === 'GET' && req.url === '/ice-servers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ iceServers: getIceServers() }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 25000,
});

// In-memory room store: roomId -> Map<socketId, Participant>
const rooms = new Map();
// Socket to room mapping: socketId -> roomId
const socketRoomMap = new Map();
// Empty room deletion timers: roomId -> NodeJS.Timeout
const emptyRoomTimers = new Map();
// Rate limit tracker: socketId -> { count, resetTime }
const signalRateLimits = new Map();

const RATE_LIMIT_WINDOW_MS = 2000;
const MAX_SIGNALS_PER_WINDOW = 120; // Increased to 120 to accommodate multi-interface trickle ICE bursts

function checkSignalRateLimit(socketId, signalType) {
  // Never throttle critical session description negotiations (OFFER / ANSWER)
  if (signalType === 'OFFER' || signalType === 'ANSWER') {
    return true;
  }

  const now = Date.now();
  let entry = signalRateLimits.get(socketId);

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    signalRateLimits.set(socketId, entry);
    return true;
  }

  entry.count++;
  if (entry.count > MAX_SIGNALS_PER_WINDOW) {
    return false; // Rate limit exceeded for candidate spam
  }

  return true;
}

// Cleanly removes a user from a room, notifies peers, and sets empty room timer
function handleUserLeave(socket, targetRoomId) {
  const roomId = targetRoomId || socketRoomMap.get(socket.id);
  if (!roomId || !rooms.has(roomId)) return;

  const roomParticipants = rooms.get(roomId);
  if (roomParticipants.has(socket.id)) {
    roomParticipants.delete(socket.id);

    // Emit both userId and socketId for full client compatibility
    socket.to(roomId).emit('user-left', {
      userId: socket.id,
      socketId: socket.id,
    });

    logger.info(
      { socketId: socket.id, roomId, remaining: roomParticipants.size },
      'User removed from room'
    );

    // If room is now empty, schedule deletion after 60s
    if (roomParticipants.size === 0) {
      logger.info(
        { roomId, timeoutMs: EMPTY_ROOM_TIMEOUT_MS },
        'Room is empty. Scheduled for cleanup in 60 seconds'
      );

      const timer = setTimeout(() => {
        if (rooms.has(roomId) && rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          logger.info({ roomId }, 'Empty room cleaned up and deleted');
        }
        emptyRoomTimers.delete(roomId);
      }, EMPTY_ROOM_TIMEOUT_MS);

      emptyRoomTimers.set(roomId, timer);
    }
  }

  socket.leave(roomId);
  socketRoomMap.delete(socket.id);
}

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Socket client connected');

  // Handle join-room
  socket.on('join-room', ({ roomId, userData }) => {
    if (!roomId) {
      socket.emit('room-error', { message: 'Invalid room ID' });
      return;
    }

    // Clean up previous room if user switched rooms without disconnecting
    const previousRoom = socketRoomMap.get(socket.id);
    if (previousRoom && previousRoom !== roomId) {
      logger.info(
        { socketId: socket.id, previousRoom, newRoom: roomId },
        'User switching rooms. Leaving previous room cleanly.'
      );
      handleUserLeave(socket, previousRoom);
    }

    // Cancel empty room cleanup if someone joins within 60s
    if (emptyRoomTimers.has(roomId)) {
      clearTimeout(emptyRoomTimers.get(roomId));
      emptyRoomTimers.delete(roomId);
      logger.info({ roomId }, 'Cancelled empty room cleanup timer; user joined');
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const roomParticipants = rooms.get(roomId);

    // Enforce max participants limit
    if (roomParticipants.size >= MAX_PARTICIPANTS && !roomParticipants.has(socket.id)) {
      logger.warn({ roomId, socketId: socket.id }, 'Room capacity reached');
      socket.emit('room-error', {
        code: 'ROOM_FULL',
        message: `Room ${roomId} is full (maximum ${MAX_PARTICIPANTS} participants).`,
      });
      return;
    }

    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);

    // Step 17.2: Store useAIVoice in participant metadata
    const participant = {
      id: socket.id,
      name: userData?.name || `User-${socket.id.slice(0, 4)}`,
      isMuted: Boolean(userData?.isMuted),
      isSpeaking: false,
      useAIVoice: Boolean(userData?.useAIVoice),
    };

    const existingParticipants = Array.from(roomParticipants.values());
    roomParticipants.set(socket.id, participant);

    // Step 17.3: Include useAIVoice in the initial room-joined payload
    socket.emit('room-joined', {
      roomId,
      self: participant,
      existingParticipants,
      iceServers: getIceServers(),
    });

    // Notify other peers in room
    socket.to(roomId).emit('user-joined', {
      participant,
    });

    logger.info(
      {
        socketId: socket.id,
        participantName: participant.name,
        roomId,
        useAIVoice: participant.useAIVoice,
        roomSize: roomParticipants.size,
      },
      'User successfully joined room'
    );
  });

  // Step 17.1 & 17.4: Handle ai-voice-toggle and broadcast ai-voice-toggled & participant-updated
  socket.on('ai-voice-toggle', ({ useAIVoice }) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId || !rooms.has(roomId)) return;

    const participant = rooms.get(roomId).get(socket.id);
    if (participant) {
      participant.useAIVoice = Boolean(useAIVoice);
    }

    // Broadcast ai-voice-toggled to other peers in room
    socket.to(roomId).emit('ai-voice-toggled', {
      userId: socket.id,
      useAIVoice: Boolean(useAIVoice),
    });

    // Emit participant-updated to room
    io.to(roomId).emit('participant-updated', {
      userId: socket.id,
      useAIVoice: Boolean(useAIVoice),
      participant,
    });

    logger.debug(
      { socketId: socket.id, roomId, useAIVoice },
      'User toggled AI voice'
    );
  });

  // Handle signaling relay with rate limiting
  socket.on('signal', (data) => {
    if (!checkSignalRateLimit(socket.id, data.type)) {
      logger.warn({ socketId: socket.id, type: data.type }, 'Signal rate limit exceeded; throttling message');
      return;
    }

    const { to, payload, type } = data;
    if (!to) return;

    io.to(to).emit('signal', {
      from: socket.id,
      payload,
      type,
      userData: rooms.get(socketRoomMap.get(socket.id))?.get(socket.id),
    });
  });

  // Handle mute-toggle
  socket.on('mute-toggle', ({ isMuted }) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId || !rooms.has(roomId)) return;

    const participant = rooms.get(roomId).get(socket.id);
    if (participant) {
      participant.isMuted = Boolean(isMuted);
    }

    socket.to(roomId).emit('mute-toggle', {
      userId: socket.id,
      isMuted: Boolean(isMuted),
    });

    logger.debug({ socketId: socket.id, roomId, isMuted }, 'User toggled mute');
  });

  // Handle explicit leave-room
  socket.on('leave-room', ({ roomId }) => {
    logger.info({ socketId: socket.id, roomId }, 'User requested to leave room');
    handleUserLeave(socket, roomId);
  });

  // Handle disconnection & scheduled 60s room cleanup
  socket.on('disconnect', () => {
    signalRateLimits.delete(socket.id);
    handleUserLeave(socket);
    logger.info({ socketId: socket.id }, 'Socket client disconnected');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Signaling server listening on http://0.0.0.0:${PORT}`);
  logger.info(`Health check at http://localhost:${PORT}/health`);
  logger.info(`ICE configuration at http://localhost:${PORT}/ice-servers`);
});

// Graceful shutdown handling
function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  io.disconnectSockets(true);

  emptyRoomTimers.forEach((timer) => clearTimeout(timer));
  emptyRoomTimers.clear();

  server.close(() => {
    logger.info('HTTP & Socket.IO server closed. Exiting process.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing termination.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
