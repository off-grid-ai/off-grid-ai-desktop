// The single, data-derived capability rule. A model's ability to read images is NOT
// a hand-typed flag (that drifts from reality — Gemma 4 E2B shipped mislabeled as
// text-only) but a fact about its files: a chat model can see iff it ships a vision
// projector (mmproj). Both the curated catalog and the Hugging Face resolver run every
// entry through here, so `kind` can never disagree with the files.

import type { ModelFile, ModelKind } from './types'

/** True iff the file set includes a vision projector (mmproj). This is what actually
 *  gives a chat model image input at load time. */
export function hasVisionProjector(files: readonly ModelFile[]): boolean {
  return files.some((f) => f.role === 'mmproj')
}

/** Derive a model's kind from its files: a projector upgrades a chat model to vision.
 *  Non-chat kinds (image/voice/transcription) are returned unchanged — an mmproj is a
 *  chat/VLM concept and never reclassifies them. */
export function deriveKind(files: readonly ModelFile[], declared: ModelKind): ModelKind {
  if ((declared === 'text' || declared === 'vision') && hasVisionProjector(files)) {
    return 'vision'
  }
  return declared
}
