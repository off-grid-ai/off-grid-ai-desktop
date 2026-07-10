/**
 * Unit tests for the pure TTS helpers extracted from tts.ts: voice selection,
 * teardown-noise classification, and the resident-worker NDJSON line parse.
 * No child_process/electron — pure import-and-assert.
 */
import { describe, it, expect } from 'vitest';
import { chooseVoice, isTeardownNoise, parseServeLine, DEFAULT_VOICE } from '../tts-logic';

describe('chooseVoice — explicit > valid stored selection > default', () => {
  it("caller's explicit voice always wins", () => {
    expect(chooseVoice('am_michael', 'af_bella')).toBe('am_michael');
    expect(chooseVoice('am_michael', 'not-a-voice-id')).toBe('am_michael');
    expect(chooseVoice('am_michael', null)).toBe('am_michael');
  });

  it('a valid stored selection (xx_name shape) is used when no explicit voice', () => {
    expect(chooseVoice(undefined, 'af_heart')).toBe('af_heart');
    expect(chooseVoice(undefined, 'am_michael')).toBe('am_michael');
    // case-insensitive on the two-letter lang + name
    expect(chooseVoice(undefined, 'AF_Heart')).toBe('AF_Heart');
  });

  it('an invalid stored selection (a model id, not a voice) falls back to default', () => {
    expect(chooseVoice(undefined, 'kokoro-82m')).toBe(DEFAULT_VOICE);
    expect(chooseVoice(undefined, 'gemma-3n')).toBe(DEFAULT_VOICE);
    expect(chooseVoice(undefined, 'af')).toBe(DEFAULT_VOICE); // no _name segment
  });

  it('no voice and no selection → default', () => {
    expect(chooseVoice(undefined, null)).toBe(DEFAULT_VOICE);
    expect(chooseVoice(undefined, undefined)).toBe(DEFAULT_VOICE);
    expect(chooseVoice('', null)).toBe(DEFAULT_VOICE);
  });
});

describe('isTeardownNoise — the harmless onnxruntime teardown crash', () => {
  it('matches the known teardown crash strings', () => {
    expect(isTeardownNoise('mutex lock failed')).toBe(true);
    expect(isTeardownNoise('Session already disposed')).toBe(true);
    expect(isTeardownNoise('libc++abi: terminating')).toBe(true);
    expect(isTeardownNoise('MUTEX LOCK FAILED')).toBe(true); // case-insensitive
  });

  it('does not match a real error', () => {
    expect(isTeardownNoise('unknown model architecture')).toBe(false);
    expect(isTeardownNoise('')).toBe(false);
  });
});

describe('parseServeLine — NDJSON line parse', () => {
  it('parses a valid JSON line', () => {
    expect(parseServeLine('{"ready":true}')).toEqual({ ready: true });
    expect(parseServeLine('{"id":"3","ok":true}')).toEqual({ id: '3', ok: true });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseServeLine('  {"ok":false,"error":"boom"}  ')).toEqual({ ok: false, error: 'boom' });
  });

  it('a blank / whitespace-only line yields null', () => {
    expect(parseServeLine('')).toBeNull();
    expect(parseServeLine('   ')).toBeNull();
  });

  it('malformed JSON yields null (never throws)', () => {
    expect(parseServeLine('not json')).toBeNull();
    expect(parseServeLine('{ broken')).toBeNull();
  });
});
