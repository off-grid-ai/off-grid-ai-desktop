import { describe, it, expect } from 'vitest';
import path from 'path';
import { parseRange, isPathAllowed } from '../media-range';

describe('parseRange', () => {
  const SIZE = 1000;

  it('treats a missing/empty Range as a full 200 body', () => {
    expect(parseRange(undefined, SIZE)).toMatchObject({ start: 0, end: 999, full: true, unsatisfiable: false });
    expect(parseRange(null, SIZE)).toMatchObject({ full: true });
    expect(parseRange('bytes=-', SIZE)).toMatchObject({ full: true });
  });

  it('serves an open-ended range to the end of the file (the seek case)', () => {
    // This is exactly what the media player sends when scrubbing: `bytes=1638400-`.
    expect(parseRange('bytes=200-', SIZE)).toMatchObject({ start: 200, end: 999, full: false, unsatisfiable: false });
  });

  it('serves a bounded range, clamping the end to the last byte', () => {
    expect(parseRange('bytes=200-499', SIZE)).toMatchObject({ start: 200, end: 499 });
    expect(parseRange('bytes=200-99999', SIZE)).toMatchObject({ start: 200, end: 999 });
  });

  it('serves a suffix range (last N bytes)', () => {
    expect(parseRange('bytes=-100', SIZE)).toMatchObject({ start: 900, end: 999 });
    expect(parseRange('bytes=-99999', SIZE)).toMatchObject({ start: 0, end: 999 });
  });

  it('flags an unsatisfiable range (start past EOF) for a 416', () => {
    expect(parseRange('bytes=1000-', SIZE)).toMatchObject({ unsatisfiable: true });
    expect(parseRange('bytes=5000-6000', SIZE)).toMatchObject({ unsatisfiable: true });
  });
});

describe('isPathAllowed', () => {
  const root = path.resolve('/Users/x/Library/Application Support/Off Grid AI Desktop');

  it('allows files inside an allowed root', () => {
    expect(isPathAllowed(path.join(root, 'meetings/m-1.mp4'), [root])).toBe(true);
    expect(isPathAllowed(root, [root])).toBe(true);
  });

  it('blocks path-escape attempts and unrelated paths', () => {
    expect(isPathAllowed(path.join(root, '../../../etc/passwd'), [root])).toBe(false);
    expect(isPathAllowed('/etc/passwd', [root])).toBe(false);
    expect(isPathAllowed('', [root])).toBe(false);
    // A sibling dir that merely shares the prefix string must not match.
    expect(isPathAllowed(root + '-evil/secret', [root])).toBe(false);
  });
});
