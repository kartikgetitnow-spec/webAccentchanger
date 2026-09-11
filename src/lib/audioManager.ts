'use client';

class AudioManager {
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private container: HTMLDivElement | null = null;
  private audioContext: AudioContext | null = null;
  private gestureListenerAdded: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initUserGestureHandler();
    }
  }

  // Hidden container for DOM-attached audio tags
  private getContainer(): HTMLDivElement {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }
    const existing = document.getElementById('webrtc-audio-container') as HTMLDivElement;
    if (existing) {
      this.container = existing;
      return existing;
    }
    const div = document.createElement('div');
    div.id = 'webrtc-audio-container';
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    div.style.top = '-9999px';
    div.style.width = '0px';
    div.style.height = '0px';
    div.style.opacity = '0';
    div.style.pointerEvents = 'none';
    div.setAttribute('aria-hidden', 'true');
    document.body.appendChild(div);
    this.container = div;
    return div;
  }

  // Listen for user gesture to unlock browser autoplay policy and AudioContext
  public initUserGestureHandler() {
    if (this.gestureListenerAdded || typeof window === 'undefined') return;
    this.gestureListenerAdded = true;

    const unlockAudio = () => {
      // Resume AudioContext if suspended
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      // Resume any paused remote audio streams
      this.audioElements.forEach((audio) => {
        if (audio.paused && audio.srcObject) {
          audio.play().catch(() => {});
        }
      });
    };

    // Attach passive listeners for touch and click to keep AudioContext active on mobile devices
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('touchend', unlockAudio, { passive: true });
  }

  // Ensure AudioContext is instantiated and actively resumed (especially after user interaction on iOS/Android)
  public async ensureAudioContextResumed(): Promise<AudioContext> {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('[AudioManager] Failed to resume AudioContext:', err);
      }
    }
    return ctx;
  }

  // Obtain or resume AudioContext
  public getAudioContext(): AudioContext {
    if (!this.audioContext && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext!;
  }

  // Attach remote stream to hidden <audio> element with autoplay
  public attachRemoteAudio(peerId: string, stream: MediaStream): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;

    let audio = this.audioElements.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `remote-audio-${peerId}`;
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');

      const container = this.getContainer();
      container.appendChild(audio);
      this.audioElements.set(peerId, audio);
    }

    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
    }

    audio.play().catch((err) => {
      console.warn(`[AudioManager] Autoplay blocked for peer ${peerId}. Waiting for user gesture:`, err);
      this.initUserGestureHandler();
    });

    return audio;
  }

  // Remove remote audio element on peer disconnect
  public removeRemoteAudio(peerId: string) {
    const audio = this.audioElements.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
      this.audioElements.delete(peerId);
    }
  }

  // Set individual participant volume (0 to 1 or 0 to 100)
  public setParticipantVolume(peerId: string, volume: number) {
    const audio = this.audioElements.get(peerId);
    if (audio) {
      const clamped = Math.max(0, Math.min(1, volume > 1 ? volume / 100 : volume));
      audio.volume = clamped;
    }
  }

  // Set master volume across all remote streams
  public setAllVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume > 1 ? volume / 100 : volume));
    this.audioElements.forEach((audio) => {
      audio.volume = clamped;
    });
  }

  // Clean up all audio elements and context
  public cleanup() {
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
    });
    this.audioElements.clear();

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const audioManager = new AudioManager();
export default audioManager;
