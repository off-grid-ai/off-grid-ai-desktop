import { describe, it, expect } from 'vitest';
import { round64, parseSize, resolveDims } from '../dimensions';

describe('round64', () => {
  it('rounds to the nearest multiple of 64', () => {
    expect(round64(500)).toBe(512); // 500/64 = 7.8 -> 8 -> 512
    expect(round64(520)).toBe(512); // 520/64 = 8.125 -> 8 -> 512
  });

  it('rounds half up like Math.round (8.5 -> 9)', () => {
    expect(round64(544)).toBe(576); // 544/64 = 8.5 -> Math.round = 9 -> 576
  });

  it('clamps to a minimum of 256', () => {
    expect(round64(0)).toBe(256);
    expect(round64(100)).toBe(256);
    expect(round64(-500)).toBe(256);
  });

  it('clamps to a maximum of 2048', () => {
    expect(round64(5000)).toBe(2048);
    expect(round64(2048)).toBe(2048);
  });

  it('passes exact multiples through unchanged (within range)', () => {
    expect(round64(1024)).toBe(1024);
    expect(round64(512)).toBe(512);
  });
});

describe('parseSize', () => {
  it('parses a WIDTHxHEIGHT string', () => {
    expect(parseSize('512x768')).toEqual({ width: 512, height: 768 });
  });

  it('accepts the unicode times separator', () => {
    expect(parseSize('640×480')).toEqual({ width: 640, height: 480 });
  });

  it('tolerates surrounding whitespace and inner spaces', () => {
    expect(parseSize('  256 x 256 ')).toEqual({ width: 256, height: 256 });
  });

  it('returns empty for a non-string', () => {
    expect(parseSize(512)).toEqual({});
    expect(parseSize(undefined)).toEqual({});
    expect(parseSize(null)).toEqual({});
  });

  it('returns empty for a malformed string', () => {
    expect(parseSize('big')).toEqual({});
    expect(parseSize('512')).toEqual({});
    expect(parseSize('512x')).toEqual({});
  });
});

describe('resolveDims', () => {
  it('uses explicit numeric width/height as-is (no rounding)', () => {
    expect(resolveDims({ width: 500, height: 700 })).toEqual({ width: 500, height: 700 });
  });

  it('ignores explicit width/height when either is not a number', () => {
    // falls through to size
    expect(resolveDims({ width: 500, height: '700', size: '256x256' })).toEqual({ width: 256, height: 256 });
  });

  it('parses an OpenAI size string when width/height absent', () => {
    expect(resolveDims({ size: '768x512' })).toEqual({ width: 768, height: 512 });
  });

  it('derives square dims from a 1:1 aspect ratio at the default 1K resolution', () => {
    expect(resolveDims({ aspect_ratio: '1:1' })).toEqual({ width: 1024, height: 1024 });
  });

  it('derives landscape dims from a 16:9 aspect ratio (long edge = width)', () => {
    // ar = 1.777 >= 1 -> [1024, 1024/1.777=576] -> round64(576)=576
    expect(resolveDims({ aspect_ratio: '16:9' })).toEqual({ width: 1024, height: 576 });
  });

  it('derives portrait dims from a 9:16 aspect ratio (long edge = height)', () => {
    // ar = 0.5625 < 1 -> [1024*0.5625=576, 1024]
    expect(resolveDims({ aspect_ratio: '9:16' })).toEqual({ width: 576, height: 1024 });
  });

  it('honors a 2K resolution as the long edge', () => {
    expect(resolveDims({ aspect_ratio: '1:1', resolution: '2K' })).toEqual({ width: 1536, height: 1536 });
  });

  it('honors a 512 resolution as the long edge', () => {
    expect(resolveDims({ aspect_ratio: '1:1', resolution: '512' })).toEqual({ width: 512, height: 512 });
  });

  it('accepts x and unicode separators in aspect_ratio', () => {
    expect(resolveDims({ aspect_ratio: '1x1' })).toEqual({ width: 1024, height: 1024 });
    expect(resolveDims({ aspect_ratio: '1×1' })).toEqual({ width: 1024, height: 1024 });
  });

  it('returns empty when nothing resolvable is provided', () => {
    expect(resolveDims({})).toEqual({});
    expect(resolveDims({ size: 'nope', aspect_ratio: 'nope' })).toEqual({});
  });

  it('prefers explicit dims over size over aspect_ratio', () => {
    expect(resolveDims({ width: 100, height: 200, size: '512x512', aspect_ratio: '1:1' })).toEqual({
      width: 100,
      height: 200,
    });
    expect(resolveDims({ size: '512x512', aspect_ratio: '1:1' })).toEqual({ width: 512, height: 512 });
  });
});
