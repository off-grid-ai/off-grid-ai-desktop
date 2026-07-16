import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mimeForExt } from '../mime'
import { IMAGE_EXT } from '../files-classify'

describe('mimeForExt — single source of truth for ext -> MIME', () => {
  it('resolves video / audio / image extensions', () => {
    expect(mimeForExt('mp4')).toBe('video/mp4')
    expect(mimeForExt('m4v')).toBe('video/mp4')
    expect(mimeForExt('mov')).toBe('video/quicktime')
    expect(mimeForExt('webm')).toBe('video/webm')
    expect(mimeForExt('mp3')).toBe('audio/mpeg')
    expect(mimeForExt('m4a')).toBe('audio/mp4')
    expect(mimeForExt('wav')).toBe('audio/wav')
    expect(mimeForExt('aac')).toBe('audio/aac')
    expect(mimeForExt('ogg')).toBe('audio/ogg')
    expect(mimeForExt('png')).toBe('image/png')
    expect(mimeForExt('jpg')).toBe('image/jpeg')
    expect(mimeForExt('jpeg')).toBe('image/jpeg')
    expect(mimeForExt('gif')).toBe('image/gif')
    expect(mimeForExt('bmp')).toBe('image/bmp')
    expect(mimeForExt('heic')).toBe('image/heic')
  })

  // The webp bug: tools.ts inlined `endsWith('.png') ? png : jpeg`, so a .webp
  // attachment was mislabeled image/jpeg (which the vision model may reject).
  // The single map is the fix — webp resolves to its real type on every path.
  it('resolves webp to image/webp (never image/jpeg)', () => {
    expect(mimeForExt('webp')).toBe('image/webp')
    expect(mimeForExt('webp', 'image/png')).toBe('image/webp')
  })

  it('accepts an ext with a leading dot and any case (path.extname / raw ext both work)', () => {
    expect(mimeForExt('.mp4')).toBe('video/mp4') // media-server passes path.extname (dotted)
    expect(mimeForExt('.MP4')).toBe('video/mp4')
    expect(mimeForExt('JPEG')).toBe('image/jpeg')
    expect(mimeForExt('.WebP')).toBe('image/webp')
  })

  it('falls back per caller context for an unknown extension', () => {
    // file-serving callers (ogcapture protocol, media server) default octet-stream
    expect(mimeForExt('xyz')).toBe('application/octet-stream')
    expect(mimeForExt('')).toBe('application/octet-stream')
    // image-attachment callers pass image/png as the fallback for a TRULY unknown ext
    expect(mimeForExt('tiff', 'image/png')).toBe('image/png')
  })

  // Every ext files-classify's IMAGE_EXT accepts must be in the map, or that upload
  // is mislabelled (the class of bug this map exists to prevent). Guard it directly.
  it('covers every accepted image upload extension (no fallback for an accepted type)', () => {
    // Asserted against the ROUTER's own accept-list (single source), not a re-hardcoded
    // copy: any ext the uploader accepts must resolve to a real image/* MIME, never the
    // fallback — that mismatch is the mislabel bug this map prevents.
    for (const ext of IMAGE_EXT) {
      expect(mimeForExt(ext, 'SENTINEL')).not.toBe('SENTINEL')
      expect(mimeForExt(ext, 'SENTINEL')).toMatch(/^image\//)
    }
  })
})

// tools.ts is a coverage-excluded I/O shell (agentic loop). Guard its webp fix by
// reading the source (§D contract guard): it must route attachments through the
// shared map, never re-inline the old `endsWith('.png') ? png : jpeg` guess that
// mislabelled webp. Fails-before (the inline was present) / passes-after.
describe('tools.ts attachment MIME — no re-inlined png/jpeg guess', () => {
  const src = readFileSync(join(__dirname, '../tools.ts'), 'utf8')
  it('imports the shared ext->MIME resolver', () => {
    expect(src).toContain("import { mimeFromExt } from './model-server/data-url'")
  })
  it('does not inline the .png-or-jpeg ternary that mislabelled webp', () => {
    expect(src).not.toMatch(/endsWith\('\.png'\)\s*\?\s*'image\/png'\s*:\s*'image\/jpeg'/)
  })
})
