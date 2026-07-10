/**
 * Unit tests for the pure upload-classification helpers extracted from files.ts.
 * Routing by extension (image/audio/video/pdf/docx/else-text) + the name
 * sanitizer. No fs/electron — pure import-and-assert.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyUpload,
  sanitizeUploadName,
  IMAGE_EXT,
  AUDIO_EXT,
  VIDEO_EXT,
} from '../files-classify';

describe('classifyUpload — route by extension', () => {
  it('every image extension classifies as image', () => {
    for (const ext of IMAGE_EXT) {
      expect(classifyUpload(`photo.${ext}`)).toBe('image');
    }
  });

  it('every audio extension classifies as audio', () => {
    for (const ext of AUDIO_EXT) {
      expect(classifyUpload(`clip.${ext}`)).toBe('audio');
    }
  });

  it('every video extension classifies as video', () => {
    for (const ext of VIDEO_EXT) {
      expect(classifyUpload(`movie.${ext}`)).toBe('video');
    }
  });

  it('pdf classifies as pdf', () => {
    expect(classifyUpload('report.pdf')).toBe('pdf');
  });

  it('docx classifies as docx', () => {
    expect(classifyUpload('memo.docx')).toBe('docx');
  });

  it('an unknown extension falls through to text', () => {
    expect(classifyUpload('script.ts')).toBe('text');
    expect(classifyUpload('data.csv')).toBe('text');
    expect(classifyUpload('notes.md')).toBe('text');
  });

  it('uppercase extensions are lowercased before matching', () => {
    expect(classifyUpload('PHOTO.PNG')).toBe('image');
    expect(classifyUpload('Clip.MP3')).toBe('audio');
    expect(classifyUpload('REPORT.PDF')).toBe('pdf');
  });

  it('a name with no extension is treated as text', () => {
    expect(classifyUpload('README')).toBe('text');
    expect(classifyUpload('Makefile')).toBe('text');
  });

  it('uses the LAST extension of a multi-dot name', () => {
    expect(classifyUpload('archive.tar.gz')).toBe('text');
    expect(classifyUpload('my.vacation.jpg')).toBe('image');
  });
});

describe('sanitizeUploadName — strip path-unsafe characters', () => {
  it('collapses runs of unsafe characters to a single underscore', () => {
    expect(sanitizeUploadName('my file (1).png')).toBe('my_file_1_.png');
  });

  it('preserves word chars, dots, and dashes', () => {
    expect(sanitizeUploadName('report-2024_final.v2.pdf')).toBe('report-2024_final.v2.pdf');
  });

  it('replaces slashes and other separators', () => {
    expect(sanitizeUploadName('a/b\\c:d')).toBe('a_b_c_d');
  });

  it('a clean name is returned unchanged', () => {
    expect(sanitizeUploadName('photo.png')).toBe('photo.png');
  });
});
