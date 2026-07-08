// Pure transforms for the /v1/models response. No I/O. Extracted from
// model-server.ts so the capability -> kind tagging, the model-entry builder,
// and the ollama-style mirror are unit-testable. The handler still does the
// actual upstream fetch + active-model lookups; it feeds the results here.

/** Tag an upstream LLM entry chat vs vision from its advertised capabilities. */
export function tagLlmEntry(m: Record<string, unknown>): Record<string, unknown> {
  const caps = Array.isArray(m.capabilities) ? (m.capabilities as string[]) : [];
  return { ...m, kind: caps.includes('multimodal') || caps.includes('vision') ? 'vision' : 'chat' };
}

/** Tag every upstream LLM entry. */
export function tagLlmEntries(upData: Record<string, unknown>[]): Record<string, unknown>[] {
  return upData.map(tagLlmEntry);
}

/** Build a canonical /v1/models entry for a non-LLM modality pick. */
export function modelEntry(
  id: string,
  kind: string,
  now: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { id, object: 'model', created: now, owned_by: 'off-grid', kind, ...extra };
}

/** Mirror the canonical data list into the ollama-style `models` array. */
export function ollamaMirror(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return data.map((m) => ({ name: m.id, model: m.id, type: 'model', kind: m.kind }));
}
