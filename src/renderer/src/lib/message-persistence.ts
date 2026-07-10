// Pure carrier logic for persisting assistant-turn metadata through the RAG
// message `context` blob. The chat "Thinking"/reasoning block is held only in
// React state while a turn streams; unless it rides in the persisted `context`
// it VANISHES on reload/conversation-remap. `context` is a freeform JSON blob
// that `addRagMessage` already persists and `mapRagMessages` already parses
// (toolCalls / image / attachments all restore from it), so reasoning rides
// there too — no schema or IPC signature change.
//
// These two functions are exact inverses:
//   buildAssistantContext(baseCtx, { reasoning }) → ctx   (write path)
//   readReasoning(ctx) → string | undefined              (read path)

/** Extra assistant-turn fields that ride in the persisted `context` blob. */
export interface AssistantContextExtras {
  /** The model's reasoning / "Thinking" text for the turn, if any. */
  reasoning?: string;
}

/**
 * Merge assistant-turn extras into the base context object without dropping any
 * existing fields (unified/toolCalls/image/attachments). Only attaches
 * `reasoning` when it is non-empty — an absent or blank reasoning must NOT add
 * an empty-string key (no persisted noise, and readReasoning stays undefined).
 * Returns `undefined` only when there is genuinely nothing to persist, matching
 * the existing "no context" convention.
 */
export function buildAssistantContext(
  baseCtx: Record<string, unknown> | undefined,
  extras: AssistantContextExtras = {},
): Record<string, unknown> | undefined {
  const reasoning = extras.reasoning?.trim() ? extras.reasoning : undefined;
  if (!baseCtx && reasoning === undefined) return undefined;
  const ctx: Record<string, unknown> = { ...(baseCtx ?? {}) };
  if (reasoning !== undefined) ctx.reasoning = reasoning;
  return ctx;
}

/**
 * Restore the reasoning text from a persisted context blob. The exact inverse
 * of buildAssistantContext — returns `undefined` (never an empty string) when
 * there is no usable reasoning, so a restored message renders no empty
 * "Thinking" block.
 */
export function readReasoning(ctx: unknown): string | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined;
  const r = (ctx as { reasoning?: unknown }).reasoning;
  return typeof r === 'string' && r.trim() ? r : undefined;
}
