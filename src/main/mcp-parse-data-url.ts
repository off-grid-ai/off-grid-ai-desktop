// Pure data-URL parsing extracted from mcp-server.ts's materialize(), so the
// base64-vs-uri decode and mime->ext inference can be unit-tested without fs/http.
// Behaviour is unchanged — mcp-server.ts imports this back.

export interface ParsedDataUrl {
  data: Buffer;
  ext: string;
}

/** Decode a `data:` URL into its bytes + a file extension. The extension is
 *  inferred from the mime subtype (`image/png` -> `png`); when it can't be, or
 *  the ref isn't a data URL, `fallbackExt` is used. base64 payloads are decoded
 *  as base64, everything else as a URI-encoded string. */
export function parseDataUrl(ref: string, fallbackExt: string): ParsedDataUrl {
  const url = ref.trim();
  const comma = url.indexOf(',');
  const meta = url.slice(5, comma);
  const ext = /(\w+)\/(\w+)/.exec(meta)?.[2] || fallbackExt;
  const data = meta.includes('base64')
    ? Buffer.from(url.slice(comma + 1), 'base64')
    : Buffer.from(decodeURIComponent(url.slice(comma + 1)));
  return { data, ext };
}
