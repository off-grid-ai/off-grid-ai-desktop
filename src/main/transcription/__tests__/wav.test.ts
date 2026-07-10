import { describe, it, expect } from 'vitest';
import { encodeWav, decodeWavPcm16 } from '../wav';

describe('encodeWav', () => {
  it('writes a valid 44-byte RIFF/WAVE header for mono 16-bit PCM', () => {
    const wav = encodeWav(new Float32Array([0, 0]), 16000);
    const dv = new DataView(wav.buffer);
    const str = (o: number, n: number): string =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => dv.getUint8(o + i)));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(16000); // sample rate
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
    expect(str(36, 4)).toBe('data');
  });

  it('emits 2 bytes per sample after the 44-byte header', () => {
    const wav = encodeWav(new Float32Array([0.1, -0.2, 0.3]), 16000);
    expect(wav.length).toBe(44 + 3 * 2);
    const dv = new DataView(wav.buffer);
    expect(dv.getUint32(40, true)).toBe(3 * 2); // data size
  });

  it('clamps out-of-range samples to the 16-bit limits', () => {
    const wav = encodeWav(new Float32Array([2, -2]), 16000);
    const dv = new DataView(wav.buffer);
    expect(dv.getInt16(44, true)).toBe(0x7fff);
    expect(dv.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('decodeWavPcm16', () => {
  it('round-trips samples written by encodeWav (used to VAD-gate ffmpeg output)', () => {
    const samples = new Float32Array([0, 0.25, -0.5, 0.75, -1]);
    const decoded = decodeWavPcm16(encodeWav(samples, 16000));
    expect(decoded.length).toBe(samples.length);
    // 16-bit quantization → allow a tiny tolerance.
    for (let i = 0; i < samples.length; i++) expect(decoded[i]).toBeCloseTo(samples[i]!, 3);
  });

  it('returns empty for a non-WAVE / truncated buffer (no crash, no phantom samples)', () => {
    expect(decodeWavPcm16(new Uint8Array(44)).length).toBe(0);  // zeros, no RIFF magic
    expect(decodeWavPcm16(new Uint8Array(10)).length).toBe(0);
  });

  it('finds the data chunk past a LIST/INFO chunk (the layout ffmpeg actually writes)', () => {
    // Regression: the bundled ffmpeg inserts a LIST/INFO (encoder tag) chunk between
    // `fmt ` and `data`, so PCM does NOT start at byte 44. A fixed-44 read would
    // decode the LIST bytes as loud "speech" and throw off the silence gate.
    const base = encodeWav(new Float32Array([0.5, -0.5, 0.25]), 16000);
    // Splice a fake LIST chunk (id + size + 4-byte body) right before `data`.
    const dataIdx = base.indexOf(0x64); // rough; rebuild precisely below
    void dataIdx;
    // Build: header(0..36 = RIFF+fmt) + LIST chunk + data chunk from `base`.
    const headerEnd = 36; // RIFF(12) + fmt (24) in encodeWav's layout
    const listChunk = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 0x49, 0x4e, 0x46, 0x4f]); // "LIST",size=4,"INFO"
    const tail = base.subarray(headerEnd); // "data" + size + samples
    const withList = new Uint8Array(headerEnd + listChunk.length + tail.length);
    withList.set(base.subarray(0, headerEnd), 0);
    withList.set(listChunk, headerEnd);
    withList.set(tail, headerEnd + listChunk.length);
    const decoded = decodeWavPcm16(withList);
    expect(decoded.length).toBe(3);
    expect(decoded[0]).toBeCloseTo(0.5, 3);
    expect(decoded[1]).toBeCloseTo(-0.5, 3);
  });
});
