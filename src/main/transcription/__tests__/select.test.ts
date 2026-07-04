import { describe, it, expect } from 'vitest';
import { pickTranscription } from '../select';
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
