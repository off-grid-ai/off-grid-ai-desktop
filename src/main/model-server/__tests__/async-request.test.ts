import { describe, it, expect } from 'vitest';
import { isAsync, pollUrl, matchPollRoute, POLL_COLLECTIONS } from '../async-request';

describe('isAsync', () => {
  it('detects async via the query string (?async=true/1/yes)', () => {
    expect(isAsync({ url: '/v1/images?async=true', headers: {} })).toBe(true);
    expect(isAsync({ url: '/v1/images?async=1', headers: {} })).toBe(true);
    expect(isAsync({ url: '/v1/images?async=yes', headers: {} })).toBe(true);
    expect(isAsync({ url: '/v1/images?foo=bar&async=true&x=1', headers: {} })).toBe(true);
  });

  it('is case-insensitive on the query value', () => {
    expect(isAsync({ url: '/v1/images?async=TRUE', headers: {} })).toBe(true);
  });

  it('ignores an unrelated query param', () => {
    expect(isAsync({ url: '/v1/images?asyncish=true', headers: {} })).toBe(false);
    expect(isAsync({ url: '/v1/images?async=false', headers: {} })).toBe(false);
  });

  it('detects async via the X-Async header', () => {
    expect(isAsync({ url: '/x', headers: { 'x-async': 'true' } })).toBe(true);
    expect(isAsync({ url: '/x', headers: { 'x-async': '1' } })).toBe(true);
    expect(isAsync({ url: '/x', headers: { 'x-async': 'TRUE' } })).toBe(true);
  });

  it('ignores a falsey X-Async header', () => {
    expect(isAsync({ url: '/x', headers: { 'x-async': 'no' } })).toBe(false);
    expect(isAsync({ url: '/x', headers: { 'x-async': 'false' } })).toBe(false);
  });

  it('detects async via Prefer: respond-async', () => {
    expect(isAsync({ url: '/x', headers: { prefer: 'respond-async' } })).toBe(true);
    expect(isAsync({ url: '/x', headers: { prefer: 'wait=10, respond-async' } })).toBe(true);
  });

  it('detects async via a body async:true', () => {
    expect(isAsync({ url: '/x', headers: {} }, { async: true })).toBe(true);
    expect(isAsync({ url: '/x', headers: {} }, { async: false })).toBe(false);
    expect(isAsync({ url: '/x', headers: {} }, { async: 'true' })).toBe(false); // strict === true only
  });

  it('detects async via a form field', () => {
    expect(isAsync({ url: '/x', headers: {} }, undefined, { async: 'true' })).toBe(true);
    expect(isAsync({ url: '/x', headers: {} }, undefined, { async: '1' })).toBe(true);
    expect(isAsync({ url: '/x', headers: {} }, undefined, { async: 'yes' })).toBe(true);
    expect(isAsync({ url: '/x', headers: {} }, undefined, { async: 'no' })).toBe(false);
  });

  it('returns false when no signal is present', () => {
    expect(isAsync({ url: '/v1/images', headers: {} })).toBe(false);
    expect(isAsync({})).toBe(false);
  });
});

describe('pollUrl', () => {
  it('joins collection and id', () => {
    expect(pollUrl('/v1/images', 'abc')).toBe('/v1/images/abc');
  });
});

describe('matchPollRoute', () => {
  it('splits a poll-collection URL into prefix + id and flags it', () => {
    expect(matchPollRoute('/v1/images/abc123')).toEqual({
      prefix: '/v1/images',
      id: 'abc123',
      isPollCollection: true,
    });
  });

  it('recognizes every declared poll collection', () => {
    for (const c of POLL_COLLECTIONS) {
      expect(matchPollRoute(`${c}/xyz`).isPollCollection).toBe(true);
    }
  });

  it('does not flag an unknown collection', () => {
    expect(matchPollRoute('/v1/unknown/abc').isPollCollection).toBe(false);
  });

  it('splits even when there is no trailing id', () => {
    expect(matchPollRoute('/v1/images')).toEqual({ prefix: '/v1', id: 'images', isPollCollection: false });
  });
});
