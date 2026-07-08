// Transcription engine selection. Whisper (one-shot whisper-cli) is the default and
// the terminal fallback. Two opt-in engines degrade to it when their runtime isn't
// installed, so a missing/not-yet-staged binary never breaks dictation or file
// transcription:
//   - 'parakeet'         — higher-accuracy sherpa-onnx model (opt-in in dictation).
//   - 'whisper-resident' — the resident whisper-server (model stays warm) for live
//                          interim, so ticks don't reload the model each call.
// Everything that turns audio into text depends on this seam, never on a concrete
// engine module: adding an engine is a new entry here + a new TranscriptionService.
import type { TranscriptionService } from './types';
import { transcriptionService as whisper } from './whisper-cli';
import { parakeetTranscription as parakeet } from './parakeet-cli';
import { whisperServerTranscription as whisperResident, whisperServer } from './whisper-server';
import { getActiveModal } from '../active-models';
import { modelsByKind } from '@offgrid/models';
import type { ManagedRuntime } from '../runtime-manager';

export type TranscriptionEngine = 'whisper' | 'parakeet' | 'whisper-resident';

/**
 * The catalog `engine` field for a transcription model. Only Parakeet models carry an
 * explicit engine; every other transcription entry (no `engine`) is a whisper ggml
 * model. Never a runtime-only value (whisper-resident is a residency mode, not a catalog
 * model). This is the single source of truth for classifying a catalog entry by engine.
 */
export type CatalogTranscriptionEngine = 'whisper' | 'parakeet';

/** A transcription catalog entry, narrowed to what engine classification needs. */
type TranscriptionEntry = { id: string; engine?: string; files: Array<{ name: string }> };

/** The engine a catalog transcription entry belongs to. The catalog only tags Parakeet
 *  entries; anything without that tag is a whisper ggml model. Single source of truth so
 *  no caller re-does the `engine === 'parakeet'` classification. Pure. */
export function catalogEngine(entry: { engine?: string } | undefined | null): CatalogTranscriptionEngine {
  return entry?.engine === 'parakeet' ? 'parakeet' : 'whisper';
}

/**
 * The transcription catalog entries for one engine. The one place the catalog is
 * partitioned by engine — whisper-cli (its whisper/Parakeet guard) and parakeet-cli
 * (its Parakeet-only filter) both call this instead of re-filtering `modelsByKind`.
 * Pure over the passed entries; the no-arg default reads the live catalog for callers.
 */
export function modelsByEngine(
  engine: CatalogTranscriptionEngine,
  entries: readonly TranscriptionEntry[] = modelsByKind('transcription'),
): TranscriptionEntry[] {
  return entries.filter((e) => catalogEngine(e) === engine);
}

interface Services {
  whisper: TranscriptionService;
  parakeet: TranscriptionService;
  whisperResident: TranscriptionService;
}

/**
 * Pick the engine to use. Pure: takes the candidate services so the fallback logic is
 * testable without touching disk. An opt-in engine is honored only when available;
 * anything else (including an opt-in engine whose runtime isn't installed) resolves to
 * the one-shot whisper.
 */
export function pickTranscription(
  engine: TranscriptionEngine,
  services: Services,
): { service: TranscriptionService; engine: TranscriptionEngine; fellBack: boolean } {
  if (engine === 'parakeet') {
    if (services.parakeet.isAvailable()) return { service: services.parakeet, engine: 'parakeet', fellBack: false };
    return { service: services.whisper, engine: 'whisper', fellBack: true };
  }
  if (engine === 'whisper-resident') {
    if (services.whisperResident.isAvailable()) return { service: services.whisperResident, engine: 'whisper-resident', fellBack: false };
    return { service: services.whisper, engine: 'whisper', fellBack: true };
  }
  return { service: services.whisper, engine: 'whisper', fellBack: false };
}

const ALL: Services = { whisper, parakeet, whisperResident };

/**
 * The single dispatcher every real (non-test) caller goes through to resolve an engine
 * choice against the live service singletons + whisper fallback. `mode` folds in the STT
 * residency choice (resident routes a whisper pick to the warm whisper-server) before the
 * availability fallback runs, so residency + fallback are decided in ONE place. Returns
 * the chosen service, the engine actually used (post-fallback, for provenance), and
 * whether it fell back. Callers pick the field they need instead of each re-invoking
 * `pickTranscription(engine, ALL)`.
 */
export function resolveTranscription(
  engine: TranscriptionEngine,
  mode?: ResidencyMode,
): { service: TranscriptionService; engine: TranscriptionEngine; fellBack: boolean } {
  // Residency only upgrades a plain whisper request to the resident server; every other
  // engine (parakeet, an already-resident request) is unaffected. Fold it in first so the
  // availability fallback below still applies to the resulting engine.
  const requested: TranscriptionEngine =
    mode === 'resident' && engine === 'whisper' ? 'whisper-resident' : engine;
  return pickTranscription(requested, ALL);
}

type ResidencyMode = 'resident' | 'on-demand';

/** Resolve the real singleton for an engine, with the whisper fallback wired in. */
export function getTranscription(engine: TranscriptionEngine = 'whisper'): TranscriptionService {
  return resolveTranscription(engine).service;
}

/**
 * The engine implied by the user's active transcription model. Pure: takes the active
 * value + catalog entries so it's testable. Core call sites (voice:transcribe, RAG audio)
 * have no pro dictation settings to read, so the active model's catalog `engine` field is
 * the single source of truth for which engine they should use. The active value may be a
 * catalog id or a primary filename — match either. (whisper-resident is a runtime choice,
 * not a catalog model, so it never comes from here.)
 */
export function engineForActiveModel(
  active: string | null,
  entries: Array<{ id: string; engine?: TranscriptionEngine; files: Array<{ name: string }> }>,
): TranscriptionEngine {
  if (!active) return 'whisper';
  const entry = entries.find((e) => e.id === active || e.files.some((f) => f.name === active));
  return catalogEngine(entry);
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

/** The engine actually used for a requested one, after the whisper fallback. Single
 *  source of truth for labeling a recording so provenance matches what really ran
 *  (e.g. a Parakeet request labels 'whisper' when Parakeet isn't installed). */
export function effectiveEngine(engine: TranscriptionEngine): TranscriptionEngine {
  return resolveTranscription(engine).engine;
}

/** Map a chosen dictation engine + the STT residency mode to the engine to actually
 *  request. Pure. Residency only affects the whisper path: 'resident' routes whisper
 *  to the warm whisper-server ('whisper-resident'), which itself degrades to one-shot
 *  whisper-cli when its binary isn't built. Parakeet has no resident server, so it
 *  stays the one-shot CLI regardless of mode (honest — no false "resident"). This is the
 *  pure engine-picking half of resolveTranscription's `mode` fold, exported for callers
 *  (pro dictation) that need the requested engine without touching the service singletons. */
export function residentAwareEngine(
  chosen: 'whisper' | 'parakeet',
  mode: ResidencyMode,
): TranscriptionEngine {
  if (chosen === 'whisper' && mode === 'resident') return 'whisper-resident';
  return chosen;
}

/** Is the Parakeet runtime installed (binary + model present)? */
export function parakeetAvailable(): boolean {
  return parakeet.isAvailable();
}

/** Is the resident whisper-server runtime installed (binary + a model present)? */
export function residentWhisperAvailable(): boolean {
  return whisperResident.isAvailable();
}

/** STT as a ManagedRuntime for the shared residency seam. The only resident STT
 *  holder is the whisper-server; the whisper-cli and Parakeet paths are one-shot
 *  CLIs that free their model on exit. So evict stops the server; warm/release are
 *  no-ops (it lazily re-spawns via ensureUp on the next resident transcription). */
export const sttRuntime: ManagedRuntime = {
  modality: 'stt',
  evict: () => { whisperServer.stop(); },
  warm: () => { /* lazily re-spawned by whisper-server ensureUp on next use */ },
  release: () => { whisperServer.stop(); },
};
