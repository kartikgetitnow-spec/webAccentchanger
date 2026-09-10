/**
 * Audio Processing Utilities for WebRTC & Gemini Live API
 * 
 * Note on Gemini Live Audio:
 * - Input to Gemini: Must be 16kHz Mono 16-bit Linear PCM (mime_type: "audio/pcm;rate=16000").
 * - Output from Gemini: Model generates 24kHz Mono 16-bit Linear PCM (mime_type: "audio/pcm;rate=24000").
 */

/**
 * Converts Float32 audio samples (-1.0 to 1.0) to 16-bit signed integers (-32768 to 32767).
 */
export function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp sample between -1.0 and 1.0
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Converts 16-bit signed PCM integers (-32768 to 32767) to Float32 audio samples (-1.0 to 1.0).
 */
export function convertInt16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    const s = int16Array[i];
    float32Array[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return float32Array;
}

/**
 * Resamples a Float32 audio buffer from fromRate to toRate using linear interpolation.
 */
export function resampleAudio(
  buffer: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || buffer.length === 0) {
    return buffer;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originPos = i * ratio;
    const index = Math.floor(originPos);
    const fraction = originPos - index;

    const sample0 = buffer[index] || 0;
    const sample1 = buffer[index + 1] !== undefined ? buffer[index + 1] : sample0;

    result[i] = sample0 + fraction * (sample1 - sample0);
  }

  return result;
}

/**
 * Creates an audio processor node that captures microphone audio,
 * downsamples it to 16kHz mono, and emits Int16Array PCM chunks for Gemini.
 */
export function createAudioWorkletNode(
  context: AudioContext,
  onAudioChunk: (pcm16: Int16Array) => void,
  bufferSize = 4096
): ScriptProcessorNode {
  // Uses ScriptProcessorNode for universal browser compatibility
  const processor = context.createScriptProcessor(bufferSize, 1, 1);

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const inputBuffer = event.inputBuffer.getChannelData(0);
    // Downsample from AudioContext sample rate (usually 44100 or 48000) to 16000
    const resampled = resampleAudio(inputBuffer, context.sampleRate, 16000);
    const pcm16 = convertFloat32ToInt16(resampled);
    onAudioChunk(pcm16);
  };

  return processor;
}

/**
 * Audio playback queue manager for playing streaming 24kHz PCM chunks from Gemini.
 */
class PCMStreamPlayer {
  private context: AudioContext;
  private nextPlayTime = 0;

  constructor(context: AudioContext) {
    this.context = context;
  }

  playChunk(pcmData: ArrayBuffer | Int16Array, sampleRate = 24000): void {
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }

    let int16Array: Int16Array;
    if (pcmData instanceof ArrayBuffer) {
      int16Array = new Int16Array(pcmData);
    } else {
      int16Array = pcmData;
    }

    if (int16Array.length === 0) return;

    // Convert Int16 PCM to Float32
    const float32 = convertInt16ToFloat32(int16Array);

    // Create an AudioBuffer at sampleRate (24000Hz for Gemini Live)
    const audioBuffer = this.context.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);

    const currentTime = this.context.currentTime;
    const startTime = Math.max(this.nextPlayTime, currentTime);
    source.start(startTime);

    this.nextPlayTime = startTime + audioBuffer.duration;
  }

  reset(): void {
    this.nextPlayTime = 0;
  }
}

const activePlayers = new WeakMap<AudioContext, PCMStreamPlayer>();

/**
 * Plays a raw PCM chunk (default: 24kHz mono from Gemini Live).
 */
export function playPCMStream(
  pcmData: ArrayBuffer | Int16Array,
  context: AudioContext,
  sampleRate = 24000
): void {
  let player = activePlayers.get(context);
  if (!player) {
    player = new PCMStreamPlayer(context);
    activePlayers.set(context, player);
  }
  player.playChunk(pcmData, sampleRate);
}
