export enum MessageType {
  OFFER = 'OFFER',
  ANSWER = 'ANSWER',
  ICE_CANDIDATE = 'ICE_CANDIDATE',
  JOIN = 'JOIN',
  LEAVE = 'LEAVE',
  MUTE_TOGGLE = 'MUTE_TOGGLE',
  AI_VOICE_TOGGLE = 'AI_VOICE_TOGGLE',
}

export interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  useAIVoice?: boolean;
  stream?: MediaStream;
}

export interface SignalData {
  type: MessageType;
  from: string;
  to?: string;
  roomId: string;
  payload?: unknown;
  userData?: Partial<Participant>;
}

export interface RoomState {
  roomId: string | null;
  participants: Participant[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isConnected: boolean;
}
