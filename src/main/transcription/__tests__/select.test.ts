import { describe, it, expect } from 'vitest';
import { pickTranscription, engineForActiveModel, effectiveEngine, residentAwareEngine } from '../select';
import type { TranscriptionService } from '../types';

const svc = (available: boolean, tag: string): TranscriptionService => ({
  isAvailable: () => available,
  transcribe: async () => ({ text: tag }),
});

const three = (w: boolean, p: boolean, r: boolean) => ({
  whisper: svc(w, 'w'),
  parakeet: svc(p, 'p'),
  whisperResident: svc(r, 'r'),
});

describe('pickTranscription', () => {
  it('uses whisper by default', () => {
    const r = pickTranscription('whisper', three(true, true, true));
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(false);
  });

  it('uses Parakeet when requested and available', () => {
    const r = pickTranscription('parakeet', three(true, true, false));
    expect(r.engine).toBe('parakeet');
    expect(r.fellBack).toBe(false);
  });

  it('falls back to whisper when Parakeet is requested but not installed', () => {
    const r = pickTranscription('parakeet', three(true, false, false));
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(true);
  });

  it('uses the resident whisper-server when requested and available', () => {
    const r = pickTranscription('whisper-resident', three(true, false, true));
    expect(r.engine).toBe('whisper-resident');
    expect(r.fellBack).toBe(false);
  });

  it('degrades to one-shot whisper when whisper-resident is requested but not built', () => {
    const r = pickTranscription('whisper-resident', three(true, false, false));
    expect(r.engine).toBe('whisper');
    expect(r.fellBack).toBe(true);
  });

  it('never falls back for a whisper request even if whisper reports unavailable', () => {
    // whisper is the terminal fallback; selection doesn't second-guess it here.
    const r = pickTranscription('whisper', three(false, true, true));
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

describe('residentAwareEngine', () => {
  it('routes a whisper choice to whisper-resident only in resident mode', () => {
    expect(residentAwareEngine('whisper', 'resident')).toBe('whisper-resident');
    expect(residentAwareEngine('whisper', 'on-demand')).toBe('whisper');
  });

  it('keeps Parakeet on its one-shot CLI regardless of mode (no resident server)', () => {
    expect(residentAwareEngine('parakeet', 'resident')).toBe('parakeet');
    expect(residentAwareEngine('parakeet', 'on-demand')).toBe('parakeet');
  });
});

describe('effectiveEngine (fallback-aware labeling)', () => {
  // In the test environment the Parakeet runtime isn't installed, so a Parakeet
  // request must resolve to (and be labeled) 'whisper' — the exact provenance case.
  it('labels a whisper request as whisper', () => {
    expect(effectiveEngine('whisper')).toBe('whisper');
  });
  it('labels a Parakeet request as whisper when Parakeet is not installed', () => {
    expect(effectiveEngine('parakeet')).toBe('whisper');
  });
});
