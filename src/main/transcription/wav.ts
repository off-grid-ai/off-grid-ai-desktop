// Pure mono-PCM → WAV encoder. Electron-free so it's unit-testable. Used to turn
// the Float32 PCM the dictation overlay captures (via an AudioWorklet) into the
// 16-bit PCM WAV that whisper-cli reads, without a round-trip through ffmpeg.

/** Encode mono Float32 samples (range [-1, 1]) to a 16-bit PCM WAV byte buffer. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2; // 16-bit
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp then scale to signed 16-bit.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Uint8Array(buffer);
}

/** Decode a 16-bit PCM WAV byte buffer back to Float32 samples in [-1, 1]. Reads
 *  the data chunk after the 44-byte canonical header (which is exactly what ffmpeg
 *  writes with `-f wav -ar 16000 -ac 1`, and what encodeWav produces). Used to run
 *  the speech-ratio VAD gate on a decoded recording without a second ffmpeg pass. */
export function decodeWavPcm16(bytes: Uint8Array): Float32Array {
  if (bytes.length <= 44) return new Float32Array(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = (bytes.length - 44) >> 1; // 2 bytes per sample
  const out = new Float32Array(n);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(offset, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
    offset += 2;
  }
  return out;
}
