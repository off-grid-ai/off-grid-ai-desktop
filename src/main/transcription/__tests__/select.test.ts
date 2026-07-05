import { describe, it, expect } from 'vitest';
import { pickTranscription, engineForActiveModel } from '../select';
import type { TranscriptionService } from '../types';

const svc = (available: boolean, tag: string): TranscriptionService => ({
  isAvailable: () => available,
  transcribe: async () => ({ text: tag }),
});

describe('pickTranscription', () => {
  it('uses whisper by default', () => {
    const r = pickTranscription('whisper', { whisper: svc(true, 'w'), parakeet: svc(true, 'p') });
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(false);
  });

  it('uses Parakeet when requested and available', () => {
    const r = pickTranscription('parakeet', { whisper: svc(true, 'w'), parakeet: svc(true, 'p') });
    expect(r.engine).toBe('parakeet');
    expect(r.fellBack).toBe(false);
  });

  it('falls back to whisper when Parakeet is requested but not installed', () => {
    const r = pickTranscription('parakeet', { whisper: svc(true, 'w'), parakeet: svc(false, 'p') });
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(true);
  });

  it('never falls back for a whisper request even if whisper reports unavailable', () => {
    // whisper is the terminal fallback; selection doesn't second-guess it here.
    const r = pickTranscription('whisper', { whisper: svc(false, 'w'), parakeet: svc(true, 'p') });
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(false);
  });
});

describe('engineForActiveModel', () => {
  const entries = [
    { id: 'ggml-base', files: [{ name: 'ggml-base.bin' }] }, // whisper (no engine field)
    {
      id: 'csukuangfj/parakeet-v2',
      engine: 'parakeet' as const,
      files: [{ name: 'parakeet-v2.encoder.int8.onnx' }, { name: 'parakeet-v2.tokens.txt' }],
    },
  ];

  it('defaults to whisper when nothing is active', () => {
    expect(engineForActiveModel(null, entries)).toBe('whisper');
  });

  it('resolves parakeet when the active pick is the catalog id', () => {
    expect(engineForActiveModel('csukuangfj/parakeet-v2', entries)).toBe('parakeet');
  });

  it('resolves parakeet when the active pick is a primary filename (not the id)', () => {
    // active-models stores id OR filename — the filename form must still resolve.
    expect(engineForActiveModel('parakeet-v2.encoder.int8.onnx', entries)).toBe('parakeet');
  });

  it('resolves whisper for a whisper model choice', () => {
    expect(engineForActiveModel('ggml-base.bin', entries)).toBe('whisper');
  });

  it('falls back to whisper for an unknown active value', () => {
    expect(engineForActiveModel('nope', entries)).toBe('whisper');
  });
});
