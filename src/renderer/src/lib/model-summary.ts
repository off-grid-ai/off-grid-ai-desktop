// Pure helpers for the composer's active-model indicator. Zero IO so they unit-test
// without the app: format the running context window and resolve a model id to its
// display name. The hook (useActiveModelSummary) does the IPC and delegates here.

/** Format a context window in tokens as a compact label, e.g. 8192 -> "8K",
 *  131072 -> "128K". Local model contexts are powers of two, so divide by 1024.
 *  Returns null when unknown/zero so the UI can omit it. */
export function formatContextWindow(tokens?: number | null): string | null {
  if (!tokens || tokens <= 0) {
    return null
  }
  if (tokens < 1024) {
    return String(tokens)
  }
  return `${Math.round(tokens / 1024)}K`
}

/** Resolve an active model id to its catalog display name; falls back to the id when
 *  the catalog has no match (a just-imported model), null when there is no active id. */
export function resolveModelName(
  models: ReadonlyArray<{ id: string; name?: string }>,
  id: string | null | undefined
): string | null {
  if (!id) {
    return null
  }
  return models.find((m) => m.id === id)?.name ?? id
}
