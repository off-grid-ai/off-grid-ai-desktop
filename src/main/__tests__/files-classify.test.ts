/**
 * Unit tests for the pure upload-classification helpers extracted from files.ts.
 * Routing by extension (image/audio/video/pdf/docx/else-text) + the name
 * sanitizer. No fs/electron — pure import-and-assert.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  classifyUpload,
  sanitizeUploadName,
  uploadPickerExtensions,
  IMAGE_EXT,
  AUDIO_EXT,
  VIDEO_EXT,
  DOC_EXT
} from '../files-classify'

describe('classifyUpload — route by extension', () => {
  it('every image extension classifies as image', () => {
    for (const ext of IMAGE_EXT) {
      expect(classifyUpload(`photo.${ext}`)).toBe('image')
    }
  })

  it('every audio extension classifies as audio', () => {
    for (const ext of AUDIO_EXT) {
      expect(classifyUpload(`clip.${ext}`)).toBe('audio')
    }
  })

  it('every video extension classifies as video', () => {
    for (const ext of VIDEO_EXT) {
      expect(classifyUpload(`movie.${ext}`)).toBe('video')
    }
  })

  it('pdf classifies as pdf', () => {
    expect(classifyUpload('report.pdf')).toBe('pdf')
  })

  it('docx classifies as docx', () => {
    expect(classifyUpload('memo.docx')).toBe('docx')
  })

  it('an unknown extension falls through to text', () => {
    expect(classifyUpload('script.ts')).toBe('text')
    expect(classifyUpload('data.csv')).toBe('text')
    expect(classifyUpload('notes.md')).toBe('text')
  })

  it('uppercase extensions are lowercased before matching', () => {
    expect(classifyUpload('PHOTO.PNG')).toBe('image')
    expect(classifyUpload('Clip.MP3')).toBe('audio')
    expect(classifyUpload('REPORT.PDF')).toBe('pdf')
  })

  it('a name with no extension is treated as text', () => {
    expect(classifyUpload('README')).toBe('text')
    expect(classifyUpload('Makefile')).toBe('text')
  })

  it('uses the LAST extension of a multi-dot name', () => {
    expect(classifyUpload('archive.tar.gz')).toBe('text')
    expect(classifyUpload('my.vacation.jpg')).toBe('image')
  })
})

// Bug: the file-picker allowlist (rag-ipc) was a hand-maintained subset that
// drifted from the router's classify sets — it omitted gif/bmp/heic/opus/aiff/avi
// the router handles, so a user couldn't pick files the processor could ingest.
// The picker list is now derived from the same sets; these assert they agree.
describe('uploadPickerExtensions — picker allowlist agrees with the router', () => {
  const picker = uploadPickerExtensions()

  it('offers every audio/video/image format the router classifies (no omissions)', () => {
    for (const ext of [...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ...DOC_EXT]) {
      expect(picker).toContain(ext)
    }
  })

  it('offers no format the router cannot handle (every picked file classifies to a real handler)', () => {
    // For every offered extension, classifyUpload must resolve it to a concrete
    // kind — image/audio/video/pdf/docx, or text for the doc/text extensions.
    for (const ext of picker) {
      const kind = classifyUpload(`file.${ext}`)
      if (IMAGE_EXT.includes(ext)) expect(kind).toBe('image')
      else if (AUDIO_EXT.includes(ext)) expect(kind).toBe('audio')
      else if (VIDEO_EXT.includes(ext)) expect(kind).toBe('video')
      else expect(['pdf', 'docx', 'text']).toContain(kind) // DOC_EXT
    }
  })

  it('contains no duplicates (deduped across the sets)', () => {
    expect(picker.length).toBe(new Set(picker).size)
  })

  it('rag-ipc builds its picker filter from this source, not a hardcoded array', () => {
    const src = readFileSync(join(__dirname, '../rag-ipc.ts'), 'utf8')
    expect(src).toContain("import { uploadPickerExtensions } from './files-classify'")
    expect(src).toContain('extensions: uploadPickerExtensions()')
    // the old hand-maintained subset must be gone
    expect(src).not.toMatch(/'mp3',\s*'wav',\s*'m4a'/)
  })
})

describe('sanitizeUploadName — strip path-unsafe characters', () => {
  it('collapses runs of unsafe characters to a single underscore', () => {
    expect(sanitizeUploadName('my file (1).png')).toBe('my_file_1_.png')
  })

  it('preserves word chars, dots, and dashes', () => {
    expect(sanitizeUploadName('report-2024_final.v2.pdf')).toBe('report-2024_final.v2.pdf')
  })

  it('replaces slashes and other separators', () => {
    expect(sanitizeUploadName('a/b\\c:d')).toBe('a_b_c_d')
  })

  it('a clean name is returned unchanged', () => {
    expect(sanitizeUploadName('photo.png')).toBe('photo.png')
  })
})
