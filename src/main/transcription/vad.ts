// Pure energy-based voice-activity gate. Electron-free so it's unit-testable.
// Not a neural VAD (Silero etc.) — deliberately simple to avoid adding to the
// stack. Its one job is to stop whisper from hallucinating filler ("Thanks for
// watching") on silent buffers: if a recording carries no speech energy, we
// never run a pass and never paste. Threshold is tunable per call.

/** Root-mean-square amplitude of a Float32 PCM block (range ~[0, 1]). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Default RMS gate. Below this, treat the block as silence. Hand-tuned for
 *  16 kHz mic input; quiet speech still clears it, room tone does not. */
export const DEFAULT_SPEECH_RMS = 0.008;

/** True when the block carries enough energy to be worth transcribing. */
export function isSpeech(samples: Float32Array, threshold: number = DEFAULT_SPEECH_RMS): boolean {
  return rms(samples) >= threshold;
}

/** Fraction of frames (of `frameSize` samples) that clear the speech gate.
 *  Used to reject a whole recording that is essentially silent. */
export function speechRatio(
  samples: Float32Array,
  threshold: number = DEFAULT_SPEECH_RMS,
  frameSize = 1600 // 100 ms at 16 kHz
): number {
  if (samples.length === 0) return 0;
  let speechFrames = 0;
  let total = 0;
  for (let i = 0; i < samples.length; i += frameSize) {
    const frame = samples.subarray(i, Math.min(i + frameSize, samples.length));
    if (isSpeech(frame, threshold)) speechFrames++;
    total++;
  }
  return total === 0 ? 0 : speechFrames / total;
}
