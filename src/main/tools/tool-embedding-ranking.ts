// Semantic tool routing: rank connector tools by EMBEDDING similarity to the
// user's message, so a tool matches on meaning ("what meetings do I have" → a
// "calendar events" tool) rather than only on shared words. This is the
// embedding-backed implementation of the routing seam; the lexical
// rankConnectorTools() stays as the fallback for when the embeddings backend
// isn't ready. Tool embeddings are cached by content hash (name+description
// rarely change), so across turns only the query is embedded fresh.

export interface EmbedDeps {
  /** Returns a NORMALIZED embedding (so cosine similarity == dot product). */
  embed: (text: string) => Promise<number[]>
}

// Process-lifetime cache of tool embeddings, keyed by a hash of the tool text.
const toolVecCache = new Map<string, number[]>()

// djb2 — a cheap content hash for the cache key (not security-sensitive).
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

function toolText(tool: unknown): string {
  const t = tool as {
    name?: string
    description?: string
    function?: { name?: string; description?: string }
  }
  const name = t.function?.name ?? t.name ?? ''
  const desc = t.function?.description ?? t.description ?? ''
  return `${name}\n${desc}`.trim()
}

/** Dot product — equals cosine similarity for normalized vectors. */
function dot(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    s += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return s
}

async function embedTool(text: string, embed: EmbedDeps['embed']): Promise<number[]> {
  const key = hash(text)
  const hit = toolVecCache.get(key)
  if (hit) {
    return hit
  }
  const v = await embed(text)
  toolVecCache.set(key, v)
  return v
}

/** Reorder tools so the built-ins (first `keepFirst`) stay put and the connector
 *  tools after them are sorted by DESCENDING cosine similarity to `query`. Returns
 *  the input unchanged when there's nothing to gain (≤1 connector tool, empty
 *  query). THROWS if the query itself can't be embedded — the caller catches that
 *  and falls back to lexical ranking. A single tool that fails to embed is ranked
 *  last rather than failing the whole turn. */
export async function rankConnectorToolsSemantic(
  query: string,
  tools: unknown[],
  keepFirst: number,
  deps: EmbedDeps
): Promise<unknown[]> {
  if (tools.length - keepFirst <= 1 || !query.trim()) {
    return tools
  }
  const qv = await deps.embed(query) // may throw → caller falls back to lexical
  const builtins = tools.slice(0, keepFirst)
  const connectors = tools.slice(keepFirst)
  const scored = await Promise.all(
    connectors.map(async (tool, i) => {
      try {
        const tv = await embedTool(toolText(tool), deps.embed)
        return { tool, i, score: dot(qv, tv) }
      } catch {
        return { tool, i, score: -1 } // un-embeddable → rank last, don't fail all
      }
    })
  )
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return [...builtins, ...scored.map((s) => s.tool)]
}

/** Test-only: clear the tool-embedding cache between cases. */
export function _clearToolVecCache(): void {
  toolVecCache.clear()
}
