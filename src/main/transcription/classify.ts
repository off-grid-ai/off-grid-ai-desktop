// Pure catalog-by-engine classification for transcription models. A LEAF module:
// it imports only the model catalog, never the engine CLIs. This is deliberate -
// whisper-cli and parakeet-cli need these classifiers, and select.ts needs both the
// classifiers AND the CLI singletons. If the classifiers lived in select.ts (which
// imports the CLIs), the CLIs importing them back would form a load-time cycle and
// select's `const ALL = { whisper, ... }` would read a not-yet-initialized singleton
// (a temporal-dead-zone crash on boot). Keeping them here breaks that cycle.
import { modelsByKind } from '@offgrid/models'

/**
 * The catalog `engine` field for a transcription model. Only Parakeet models carry an
 * explicit engine; every other transcription entry (no `engine`) is a whisper ggml
 * model. Never a runtime-only value (whisper-resident is a residency mode, not a catalog
 * model). Single source of truth for classifying a catalog entry by engine.
 */
export type CatalogTranscriptionEngine = 'whisper' | 'parakeet'

/** A transcription catalog entry, narrowed to what engine classification needs. */
export type TranscriptionEntry = { id: string; engine?: string; files: Array<{ name: string }> }

/** The engine a catalog transcription entry belongs to. The catalog only tags Parakeet
 *  entries; anything without that tag is a whisper ggml model. Single source of truth so
 *  no caller re-does the `engine === 'parakeet'` classification. Pure. */
export function catalogEngine(
  entry: { engine?: string } | undefined | null
): CatalogTranscriptionEngine {
  return entry?.engine === 'parakeet' ? 'parakeet' : 'whisper'
}

/**
 * The transcription catalog entries for one engine. The one place the catalog is
 * partitioned by engine - whisper-cli (its whisper/Parakeet guard) and parakeet-cli
 * (its Parakeet-only filter) both call this instead of re-filtering `modelsByKind`.
 * Pure over the passed entries; the no-arg default reads the live catalog for callers.
 */
export function modelsByEngine(
  engine: CatalogTranscriptionEngine,
  entries: readonly TranscriptionEntry[] = modelsByKind('transcription')
): TranscriptionEntry[] {
  return entries.filter((e) => catalogEngine(e) === engine)
}
