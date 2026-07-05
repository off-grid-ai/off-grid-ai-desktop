// Transcription engine selection. Whisper is the default; Parakeet is opt-in and only
// used when its runtime is actually installed — otherwise we fall back to whisper so a
// missing/not-yet-staged Parakeet binary never breaks dictation or file transcription.
import type { TranscriptionService } from './types';
import { transcriptionService as whisper } from './whisper-cli';
import { parakeetTranscription as parakeet } from './parakeet-cli';
import { getActiveModal } from '../active-models';
import { modelsByKind } from '@offgrid/models';

export type TranscriptionEngine = 'whisper' | 'parakeet';

/**
 * Pick the engine to use. Pure: takes the candidate services so the fallback logic is
 * testable without touching disk. Parakeet is honored only when available; anything
 * else (including 'parakeet' when not installed) resolves to whisper.
 */
export function pickTranscription(
  engine: TranscriptionEngine,
  services: { whisper: TranscriptionService; parakeet: TranscriptionService },
): { service: TranscriptionService; engine: TranscriptionEngine; fellBack: boolean } {
  if (engine === 'parakeet') {
    if (services.parakeet.isAvailable()) {
      return { service: services.parakeet, engine: 'parakeet', fellBack: false };
    }
    return { service: services.whisper, engine: 'whisper', fellBack: true };
  }
  return { service: services.whisper, engine: 'whisper', fellBack: false };
}

/** Resolve the real singleton for an engine, with the whisper fallback wired in. */
export function getTranscription(engine: TranscriptionEngine = 'whisper'): TranscriptionService {
  return pickTranscription(engine, { whisper, parakeet }).service;
}

/**
 * The engine implied by the user's active transcription model. Pure: takes the active
 * value + catalog entries so it's testable. Core call sites (voice:transcribe, RAG audio)
 * have no pro dictation settings to read, so the active model's catalog `engine` field is
 * the single source of truth for which engine they should use. The active value may be a
 * catalog id or a primary filename — match either.
 */
export function engineForActiveModel(
  active: string | null,
  entries: Array<{ id: string; engine?: TranscriptionEngine; files: Array<{ name: string }> }>,
): TranscriptionEngine {
  if (!active) return 'whisper';
  const entry = entries.find((e) => e.id === active || e.files.some((f) => f.name === active));
  return entry?.engine === 'parakeet' ? 'parakeet' : 'whisper';
}

/**
 * Resolve the transcription service implied by the active model choice, honoring the
 * whisper fallback when Parakeet isn't installed. This is what core, engine-agnostic
 * paths (generic mic transcription, file/RAG ingestion) call so a Parakeet selection is
 * actually used instead of always running whisper.
 */
export function getActiveTranscription(): TranscriptionService {
  const engine = engineForActiveModel(getActiveModal('transcription'), modelsByKind('transcription'));
  return getTranscription(engine);
}

/** Is the Parakeet runtime installed (binary + model present)? */
export function parakeetAvailable(): boolean {
  return parakeet.isAvailable();
}
