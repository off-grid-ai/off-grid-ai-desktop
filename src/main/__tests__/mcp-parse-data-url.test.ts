/**
 * Unit tests for parseDataUrl, extracted from mcp-server.ts's materialize().
 * Data-URL base64-vs-uri decode + mime->ext inference + fallback. No fs/http.
 */
import { describe, it, expect } from 'vitest';
import { parseDataUrl } from '../mcp-parse-data-url';

describe('parseDataUrl — decode + extension inference', () => {
  it('decodes a base64 data URL and infers the extension from the mime subtype', () => {
    const bytes = Buffer.from('hello world');
    const url = `data:image/png;base64,${bytes.toString('base64')}`;
    const { data, ext } = parseDataUrl(url, 'bin');
    expect(ext).toBe('png');
    expect(data.equals(bytes)).toBe(true);
  });

  it('decodes a plain (URI-encoded) data URL as text', () => {
    const url = 'data:text/plain,hello%20world';
    const { data, ext } = parseDataUrl(url, 'bin');
    expect(ext).toBe('plain');
    expect(data.toString()).toBe('hello world');
  });

  it('infers ext from the subtype for audio', () => {
    const url = `data:audio/wav;base64,${Buffer.from('x').toString('base64')}`;
    expect(parseDataUrl(url, 'png').ext).toBe('wav');
  });

  it('uses fallbackExt when the mime has no parseable subtype', () => {
    // meta = "" (no comma-preceded metadata beyond the scheme) -> regex misses.
    const url = 'data:,rawtext';
    expect(parseDataUrl(url, 'txt').ext).toBe('txt');
  });

  it('uses fallbackExt when there is no mime at all before the payload', () => {
    const url = `data:;base64,${Buffer.from('y').toString('base64')}`;
    expect(parseDataUrl(url, 'dat').ext).toBe('dat');
  });

  it('a malformed data URL (no comma) returns EMPTY bytes + fallbackExt, never decodes garbage', () => {
    const { data, ext } = parseDataUrl('data:garbage', 'png');
    expect(ext).toBe('png');
    expect(data.length).toBe(0); // no comma -> nothing valid to decode
  });

  it('a non-base64 payload with a stray % falls back to raw bytes instead of throwing URIError', () => {
    // decodeURIComponent('bad%zz') throws; the guard must catch and return raw bytes.
    expect(() => parseDataUrl('data:text/plain,bad%zz', 'txt')).not.toThrow();
    const { data, ext } = parseDataUrl('data:text/plain,bad%zz', 'txt');
    expect(ext).toBe('plain');
    expect(data.toString()).toBe('bad%zz');
  });
});
