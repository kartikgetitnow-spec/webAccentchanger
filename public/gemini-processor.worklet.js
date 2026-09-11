class GeminiVoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Clone Float32Array slice to ensure safe transfer across audio thread and main thread
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('gemini-voice-capture', GeminiVoiceCaptureProcessor);
