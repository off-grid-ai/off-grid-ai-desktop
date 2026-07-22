// Pure data-URL parsing extracted from mcp-server.ts's materialize(), so the
// base64-vs-uri decode and mime->ext inference can be unit-tested without fs/http.
// Behaviour is unchanged — mcp-server.ts imports this back.

export interface ParsedDataUrl {
  data: Buffer
  ext: string
}

/** Decode a `data:` URL into its bytes + a file extension. The extension is
 *  inferred from the mime subtype (`image/png` -> `png`); when it can't be, or
 *  the ref isn't a data URL, `fallbackExt` is used. base64 payloads are decoded
 *  as base64, everything else as a URI-encoded string. */
export function parseDataUrl(ref: string, fallbackExt: string): ParsedDataUrl {
  const url = ref.trim()
  const comma = url.indexOf(',')
  // A data: URL MUST have a comma separating the metadata from the payload. Without
  // one (truncated / malformed ref) there is nothing valid to decode — return empty
  // bytes rather than slicing garbage out of the metadata section.
  if (comma === -1) {
    return { data: Buffer.alloc(0), ext: fallbackExt }
  }
  const meta = url.slice(5, comma)
  const ext = /(\w+)\/(\w+)/.exec(meta)?.[2] || fallbackExt
  const payload = url.slice(comma + 1)
  // base64 is a standalone `;`-delimited token per the data-URL grammar (e.g.
  // `image/png;base64`), NOT any occurrence of the substring — a param value like
  // `name=mybase64file` must not flip the payload into base64 decoding.
  const isBase64 = meta.split(';').some((seg) => seg.trim().toLowerCase() === 'base64')
  if (isBase64) {
    return { data: Buffer.from(payload, 'base64'), ext }
  }
  // A non-base64 payload is a URI-encoded string; a stray '%' makes decodeURIComponent
  // throw URIError — fall back to the raw bytes instead of bubbling it to the caller.
  try {
    return { data: Buffer.from(decodeURIComponent(payload)), ext }
  } catch {
    return { data: Buffer.from(payload), ext }
  }
}
