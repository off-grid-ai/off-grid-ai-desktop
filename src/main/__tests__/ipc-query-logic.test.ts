import { describe, it, expect } from 'vitest';
import {
  tokenizeQuery,
  isGenerativeRequest,
  clipText,
  safeParseJson,
  isTrivialMessage,
  STOPWORDS,
} from '../ipc-query-logic';

describe('tokenizeQuery', () => {
  it('lowercases, splits on whitespace, and strips punctuation', () => {
    expect(tokenizeQuery('Hello, World! Foobar')).toEqual(['hello', 'world', 'foobar']);
  });

  it('drops tokens shorter than 3 chars', () => {
    // 'to' (2) and 'go' (2) are dropped; 'now' (3) kept
    expect(tokenizeQuery('go to now')).toEqual(['now']);
  });

  it('drops stopwords', () => {
    // every token here is a stopword → empty
    expect(tokenizeQuery('what do you know about the project', 6)).toEqual(['project']);
    // sanity: the words we dropped really are in STOPWORDS
    expect(STOPWORDS.has('what')).toBe(true);
    expect(STOPWORDS.has('about')).toBe(true);
  });

  it('de-duplicates tokens preserving first-seen order', () => {
    expect(tokenizeQuery('alpha beta alpha gamma beta')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('caps the result at maxTokens (default 6)', () => {
    const q = 'one2 two3 four5 six7 nine0 tenx elevenq twelvz';
    expect(tokenizeQuery(q).length).toBe(6);
    expect(tokenizeQuery(q, 2).length).toBe(2);
  });

  it('keeps underscores and hyphens inside a token', () => {
    expect(tokenizeQuery('foo_bar baz-qux')).toEqual(['foo_bar', 'baz-qux']);
  });
});

describe('isGenerativeRequest', () => {
  it('is true when a build verb and a code/UI noun co-occur', () => {
    expect(isGenerativeRequest('build a react app')).toBe(true);
    expect(isGenerativeRequest('write an svg')).toBe(true);
    expect(isGenerativeRequest('make a landing page')).toBe(true);
    expect(isGenerativeRequest('create a dashboard component')).toBe(true);
  });

  it('is false without a build verb', () => {
    // has the noun "app" but no verb
    expect(isGenerativeRequest('what is a react app')).toBe(false);
  });

  it('is false without a code/UI noun', () => {
    expect(isGenerativeRequest('write a poem about the sea')).toBe(false);
  });

  it('is false for empty / whitespace input', () => {
    expect(isGenerativeRequest('')).toBe(false);
    expect(isGenerativeRequest('   ')).toBe(false);
  });
});

describe('clipText', () => {
  it('returns text unchanged when under the limit', () => {
    expect(clipText('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly at the limit', () => {
    expect(clipText('hello', 5)).toBe('hello');
  });

  it('clips and appends an ellipsis when over the limit', () => {
    // limit 5 → keep 4 chars + ellipsis, length stays 5
    expect(clipText('hello world', 5)).toBe('hell…');
  });

  it('returns empty string for empty/undefined input', () => {
    expect(clipText('', 10)).toBe('');
    expect(clipText(undefined as unknown as string, 10)).toBe('');
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it('strips ```json fences before parsing', () => {
    expect(safeParseJson('```json\n{"store":true}\n```', { store: false })).toEqual({ store: true });
  });

  it('returns the fallback on invalid JSON', () => {
    const fallback = { store: false };
    expect(safeParseJson('not json at all', fallback)).toBe(fallback);
  });
});

describe('isTrivialMessage', () => {
  it('treats empty / whitespace as trivial', () => {
    expect(isTrivialMessage('')).toBe(true);
    expect(isTrivialMessage('   ')).toBe(true);
  });

  it('treats short pleasantries as trivial (case-insensitive, optional punctuation)', () => {
    expect(isTrivialMessage('hi')).toBe(true);
    expect(isTrivialMessage('OK')).toBe(true);
    expect(isTrivialMessage('Thanks!')).toBe(true);
    expect(isTrivialMessage('thank you.')).toBe(true);
  });

  it('treats a real question as non-trivial', () => {
    expect(isTrivialMessage('what did I work on yesterday?')).toBe(false);
  });

  it('a long message is never trivial even if it starts like a pleasantry', () => {
    expect(isTrivialMessage('hello there, can you help me draft an email')).toBe(false);
  });
});
