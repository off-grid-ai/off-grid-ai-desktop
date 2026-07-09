import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { guardConsoleStreams } from '../stream-guards';

// Fails-before / passes-after: a Node EventEmitter throws on emit('error') when there is NO
// 'error' listener. That is exactly why an EPIPE on stdout crashed the main process. The guard
// installs a listener so the same emit is swallowed instead of thrown.

describe('guardConsoleStreams', () => {
  it('makes an EPIPE emit on a console stream non-fatal (would throw without the guard)', () => {
    const stream = new EventEmitter();
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    // Sanity: before guarding, emitting 'error' with no listener throws (the crash we saw).
    expect(() => stream.emit('error', epipe)).toThrow(/EPIPE/);

    // After guarding, the same emit is swallowed — no throw.
    const guarded = guardConsoleStreams([stream]);
    expect(guarded).toBe(1);
    expect(() => stream.emit('error', epipe)).not.toThrow();
  });

  it('guards every provided stream and skips undefined/invalid ones', () => {
    const a = new EventEmitter();
    const b = new EventEmitter();
    expect(guardConsoleStreams([a, undefined, b, {} as never])).toBe(2);
    expect(() => a.emit('error', new Error('x'))).not.toThrow();
    expect(() => b.emit('error', new Error('y'))).not.toThrow();
  });
});
