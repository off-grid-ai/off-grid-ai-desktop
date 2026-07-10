// Pure data-URL + reference classification for image handling. No I/O.
// Extracted from model-server.ts's fetchImage/toDataUrl so the decode decision
// (base64 vs percent-encoded), mime sniffing, and reference kind are testable.

import { mimeForExt } from '../mime';

export type ImageRefKind = 'data' | 'http' | 'file';

/** Classify an image reference the gateway accepts (data:, http(s)://, path). */
export function classifyRef(ref: string): ImageRefKind {
  const url = ref.trim();
  if (url.startsWith('data:')) return 'data';
  if (url.startsWith('http://') || url.startsWith('https://')) return 'http';
  return 'file';
}

/**
 * Decode a data: URL into its bytes + mime. Mirrors the fetchImage data branch:
 * base64-encoded payloads are decoded as base64, everything else is treated as a
 * percent-encoded text payload. Defaults the mime to image/png when absent.
 */
export function decodeDataUrl(url: string): { data: Buffer; mime: string } {
  const comma = url.indexOf(',');
  const mime = /data:([^;,]+)/.exec(url)?.[1] || 'image/png';
  const meta = url.slice(5, comma);
  const raw = url.slice(comma + 1);
  const data = meta.includes('base64') ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
  return { data, mime };
}

/** Strip a leading file:// scheme, leaving a bare local path. */
export function stripFileScheme(ref: string): string {
  const url = ref.trim();
  return url.startsWith('file://') ? url.slice(7) : url;
}

/**
 * Guess an image mime from a bare file extension (no leading dot). Delegates to
 * the shared ext->MIME map (single source of truth) with an image/png fallback,
 * matching the image-attachment contract this function has always had.
 */
export function mimeFromExt(ext: string): string {
  return mimeForExt(ext, 'image/png');
}

/** Map a mime to the temp-file extension used for init images. */
export function extForMime(mime: string): string {
  return mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png';
}

/** Encode raw bytes as a base64 data URL. */
export function toDataUrl(data: Buffer, mime: string): string {
  return `data:${mime};base64,${data.toString('base64')}`;
}
