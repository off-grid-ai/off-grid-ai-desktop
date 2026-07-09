// Pure image-dimension resolution for the /v1/images endpoints. No I/O.
// Extracted from model-server.ts so the branch logic (OpenAI size, OpenRouter
// aspect_ratio + resolution, explicit width/height) is unit-testable.

// Round to a multiple of 64 (diffusion models require it), clamped sane.
export function round64(n: number): number {
  return Math.max(256, Math.min(2048, Math.round(n / 64) * 64));
}

/** Parse an OpenAI "WIDTHxHEIGHT" size string. */
export function parseSize(size: unknown): { width?: number; height?: number } {
  if (typeof size !== 'string') return {};
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
  if (!m) return {};
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

// Resolve output dimensions from any of: explicit width/height, an OpenAI
// "WIDTHxHEIGHT" size, or an OpenRouter aspect_ratio + resolution pair.
export function resolveDims(p: {
  width?: unknown;
  height?: unknown;
  size?: unknown;
  aspect_ratio?: unknown;
  resolution?: unknown;
}): { width?: number; height?: number } {
  if (typeof p.width === 'number' && typeof p.height === 'number') return { width: p.width, height: p.height };
  const fromSize = parseSize(p.size);
  if (fromSize.width && fromSize.height) return fromSize;
  if (typeof p.aspect_ratio === 'string') {
    const m = /^(\d+)\s*[:x×]\s*(\d+)$/.exec(p.aspect_ratio.trim());
    if (m) {
      const ar = parseInt(m[1], 10) / parseInt(m[2], 10);
      const res = String(p.resolution ?? '1K').toUpperCase();
      const base = res === '2K' ? 1536 : res === '512' ? 512 : 1024; // long edge
      const [w, h] = ar >= 1 ? [base, base / ar] : [base * ar, base];
      return { width: round64(w), height: round64(h) };
    }
  }
  return {};
}
