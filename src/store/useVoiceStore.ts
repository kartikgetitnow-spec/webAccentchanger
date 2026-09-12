import { create } from 'zustand';

export interface VoiceState {
  useAIVoice: boolean;
  selectedVoice: string;
  setUseAIVoice: (enabled: boolean) => void;
  setSelectedVoice: (voice: string) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  useAIVoice: false,
  selectedVoice: 'USA',
  setUseAIVoice: (useAIVoice) => set({ useAIVoice }),
  setSelectedVoice: (selectedVoice) => set({ selectedVoice }),
}));

export default useVoiceStore;
