import { describe, it, expect } from 'vitest';
import { decodeToWavArgs, DECODE_TIMEOUT_MS } from '../ffmpeg-decode';

describe('decodeToWavArgs — the shared 16 kHz mono WAV decode invocation', () => {
  it('produces the exact ffmpeg argv the three call sites used to inline', () => {
    expect(decodeToWavArgs('/in/audio.m4a', '/tmp/out.wav')).toEqual([
      '-y',
      '-i',
      '/in/audio.m4a',
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      '/tmp/out.wav'
    ]);
  });

  it('encodes the whisper/parakeet input contract: 16 kHz, mono, wav, no video', () => {
    const args = decodeToWavArgs('in', 'out');
    // sample rate 16000 immediately after -ar
    expect(args[args.indexOf('-ar') + 1]).toBe('16000');
    // 1 channel (mono) immediately after -ac
    expect(args[args.indexOf('-ac') + 1]).toBe('1');
    // wav container after -f
    expect(args[args.indexOf('-f') + 1]).toBe('wav');
    // -vn drops any video track
    expect(args).toContain('-vn');
  });

  it('places input after -i and output last', () => {
    const args = decodeToWavArgs('/a/in.mp4', '/b/out.wav');
    expect(args[args.indexOf('-i') + 1]).toBe('/a/in.mp4');
    expect(args[args.length - 1]).toBe('/b/out.wav');
  });

  it('caps the decode at 10 minutes', () => {
    expect(DECODE_TIMEOUT_MS).toBe(10 * 60_000);
  });
});
