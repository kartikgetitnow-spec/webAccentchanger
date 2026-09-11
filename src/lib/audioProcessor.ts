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
 * Uses modern AudioWorkletNode if supported by browser, with graceful fallback to ScriptProcessorNode.
 */
export async function createAudioWorkletNode(
  context: AudioContext,
  onAudioChunk: (pcm16: Int16Array) => void,
  bufferSize = 4096
): Promise<AudioNode> {
  if (typeof AudioWorkletNode !== 'undefined' && context.audioWorklet) {
    try {
      // 1. First attempt: Load static worklet file from public directory (most reliable across iOS Safari and Android)
      try {
        await context.audioWorklet.addModule('/gemini-processor.worklet.js');
      } catch (staticErr) {
        console.warn('[audioProcessor] Static worklet file load failed, attempting Blob URL fallback:', staticErr);
        // Fallback: Inline dynamic blob module
        const processorCode = `
class GeminiVoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('gemini-voice-capture', GeminiVoiceCaptureProcessor);
`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const moduleUrl = URL.createObjectURL(blob);
        try {
          await context.audioWorklet.addModule(moduleUrl);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      }

      const workletNode = new AudioWorkletNode(context, 'gemini-voice-capture');
      const sampleAccumulator: number[] = [];

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const float32Chunk = event.data;
        if (!float32Chunk || float32Chunk.length === 0) return;

        const resampled = resampleAudio(float32Chunk, context.sampleRate, 16000);
        for (let i = 0; i < resampled.length; i++) {
          sampleAccumulator.push(resampled[i]);
        }

        while (sampleAccumulator.length >= 1024) {
          const slice = new Float32Array(sampleAccumulator.splice(0, 1024));
          const pcm16 = convertFloat32ToInt16(slice);
          onAudioChunk(pcm16);
        }
      };

      return workletNode;
    } catch (workletError) {
      console.warn('[audioProcessor] AudioWorkletNode init failed, falling back to ScriptProcessorNode:', workletError);
    }
  }

  // Fallback to ScriptProcessorNode for environments without AudioWorklet support
  const processor = context.createScriptProcessor(bufferSize, 1, 1);
  const sampleAccumulator: number[] = [];

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const inputBuffer = event.inputBuffer.getChannelData(0);
    const resampled = resampleAudio(inputBuffer, context.sampleRate, 16000);
    for (let i = 0; i < resampled.length; i++) {
      sampleAccumulator.push(resampled[i]);
    }

    while (sampleAccumulator.length >= 1024) {
      const slice = new Float32Array(sampleAccumulator.splice(0, 1024));
      const pcm16 = convertFloat32ToInt16(slice);
      onAudioChunk(pcm16);
    }
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
