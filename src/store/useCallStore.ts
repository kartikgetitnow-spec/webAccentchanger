import { create } from 'zustand';
import { Participant } from '@/lib/types';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface CallState {
  roomId: string | null;
  participants: Participant[];
  isMuted: boolean;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  masterVolume: number;

  // Actions
  setRoomId: (roomId: string | null) => void;
  setParticipants: (
    participants: Participant[] | ((prev: Participant[]) => Participant[])
  ) => void;
  updateParticipant: (id: string, partial: Partial<Participant>) => void;
  removeParticipant: (id: string) => void;
  toggleMute: (forced?: boolean) => void;
  setConnected: (isConnected: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setMasterVolume: (volume: number) => void;
  reset: () => void;
}

const initialState = {
  roomId: null,
  participants: [],
  isMuted: false,
  isConnected: false,
  connectionStatus: 'disconnected' as ConnectionStatus,
  masterVolume: 100,
};

export const useCallStore = create<CallState>((set) => ({
  ...initialState,

  setRoomId: (roomId) =>
    set((state) => (state.roomId === roomId ? state : { roomId })),

  setParticipants: (updater) =>
    set((state) => ({
      participants:
        typeof updater === 'function' ? updater(state.participants) : updater,
    })),

  updateParticipant: (id, partial) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.id === id ? { ...p, ...partial } : p
      ),
    })),

  removeParticipant: (id) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.id !== id),
    })),

  toggleMute: (forced) =>
    set((state) => ({
      isMuted: typeof forced === 'boolean' ? forced : !state.isMuted,
    })),

  setConnected: (isConnected) =>
    set((state) => (state.isConnected === isConnected ? state : { isConnected })),

  setConnectionStatus: (connectionStatus) =>
    set((state) =>
      state.connectionStatus === connectionStatus ? state : { connectionStatus }
    ),

  setMasterVolume: (masterVolume) => set({ masterVolume }),

  reset: () => set(initialState),
}));

export default useCallStore;
