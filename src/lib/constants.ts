export const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302',
    ],
  },
  // Optional TURN server configuration placeholder:
  // {
  //   urls: 'turn:your-turn-server.com:3478',
  //   username: 'turn-user',
  //   credential: 'turn-password',
  // },
];

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export const SPEAKING_THRESHOLD = 20; // Audio volume threshold (0-255) for active speaker detection
