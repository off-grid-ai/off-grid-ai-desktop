import { describe, it, expect } from 'vitest';
import { encodeWav } from '../wav';

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
