import { describe, it, expect } from 'vitest';
import {
  buildWhisperServerArgs,
  whisperContextKey,
  buildInferenceFields,
  parseInferenceResponse,
} from '../whisper-server';

describe('buildWhisperServerArgs', () => {
  it('builds -m / --host / --port / -t argv from the context', () => {
    const args = buildWhisperServerArgs({ modelPath: '/models/ggml-base.bin', threads: 4, port: 8441 });
    expect(args).toEqual([
      '-m', '/models/ggml-base.bin',
      '--host', '127.0.0.1',
      '--port', '8441',
      '-t', '4',
    ]);
  });

  it('defaults the port and threads when omitted', () => {
    const args = buildWhisperServerArgs({ modelPath: '/m/ggml-small.bin' });
    // model + host are fixed; a port and a thread count are always present.
    expect(args.slice(0, 4)).toEqual(['-m', '/m/ggml-small.bin', '--host', '127.0.0.1']);
    const portIdx = args.indexOf('--port');
    expect(portIdx).toBeGreaterThan(-1);
    expect(Number(args[portIdx + 1])).toBeGreaterThan(0);
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(-1);
    expect(Number(args[tIdx + 1])).toBeGreaterThanOrEqual(1);
  });
});

describe('whisperContextKey', () => {
  it('is stable for the same context and differs on a model swap', () => {
    const a = whisperContextKey({ modelPath: '/m/base.bin', threads: 4, port: 8441 });
    const b = whisperContextKey({ modelPath: '/m/base.bin', threads: 4, port: 8441 });
    const c = whisperContextKey({ modelPath: '/m/large.bin', threads: 4, port: 8441 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('differs when the thread count changes (a restart-worthy launch arg)', () => {
    const a = whisperContextKey({ modelPath: '/m/base.bin', threads: 4 });
    const b = whisperContextKey({ modelPath: '/m/base.bin', threads: 8 });
    expect(a).not.toBe(b);
  });
});

describe('buildInferenceFields', () => {
  it('always asks for a json response', () => {
    const f = buildInferenceFields({ wavPath: '/tmp/a.wav' });
    expect(f.response_format).toBe('json');
  });

  it('omits language for auto (server auto-detects) and includes a real language', () => {
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav', language: 'auto' }).language).toBeUndefined();
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav' }).language).toBeUndefined();
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav', language: 'en' }).language).toBe('en');
  });

  it('includes and clamps the prompt, dropping an empty one', () => {
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav', prompt: '   ' }).prompt).toBeUndefined();
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav', prompt: 'Acme Corp, Kubernetes' }).prompt).toBe('Acme Corp, Kubernetes');
    const long = 'x'.repeat(2000);
    expect(buildInferenceFields({ wavPath: '/tmp/a.wav', prompt: long }).prompt?.length).toBe(800);
  });
});

describe('parseInferenceResponse', () => {
  it('parses the standard { text } json shape (trimmed)', () => {
    expect(parseInferenceResponse({ text: '  hello world  ' })).toEqual({ text: 'hello world' });
  });

  it('joins a segments-only response into text', () => {
    const body = { segments: [{ text: 'the quick ' }, { text: 'brown fox' }] };
    expect(parseInferenceResponse(body)).toEqual({ text: 'the quick brown fox' });
  });

  it('accepts a raw plain-text response verbatim', () => {
    expect(parseInferenceResponse('  just text  ')).toEqual({ text: 'just text' });
  });

  it('returns empty text for an empty/malformed body rather than throwing', () => {
    expect(parseInferenceResponse({})).toEqual({ text: '' });
    expect(parseInferenceResponse(null)).toEqual({ text: '' });
    expect(parseInferenceResponse(undefined)).toEqual({ text: '' });
    expect(parseInferenceResponse({ nope: 1 })).toEqual({ text: '' });
    expect(parseInferenceResponse({ text: 42 })).toEqual({ text: '' });
  });
});
