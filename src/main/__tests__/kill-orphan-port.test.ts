import { describe, it, expect } from 'vitest';
import { parseWindowsListenerPids } from '../kill-orphan-port';

// The win32 branch of killOrphansOnPort can't run in-process (needs netstat/tasklist), but the
// PID-parsing is pure and is the part most likely to silently break on IPv6 rows - leaving a
// crashed whisper/sd server holding the port after a restart. Real netstat output is replayed
// verbatim; no mocks. Assert the exact PID set for IPv4 + IPv6 listener rows and the negatives.

describe('parseWindowsListenerPids', () => {
  it('extracts the PID from an IPv4 LISTENING row', () => {
    const out = '\r\n  TCP    127.0.0.1:8439    0.0.0.0:0    LISTENING    12345\r\n';
    expect(parseWindowsListenerPids(out, 8439)).toEqual(['12345']);
  });

  it('extracts the PID from IPv6 rows (`[::]:port` and `[::1]:port`) - the :1 in ::1 is not mistaken for the port', () => {
    const out = [
      '  TCP    [::]:8439     [::]:0    LISTENING    22222',
      '  TCP    [::1]:8439    [::]:0    LISTENING    33333',
    ].join('\r\n');
    // Both real PIDs captured; neither the `:1` inside `::1` nor the foreign `:0` is matched.
    expect(parseWindowsListenerPids(out, 8439).sort()).toEqual(['22222', '33333']);
  });

  it('ignores rows for a DIFFERENT port and non-LISTENING states', () => {
    const out = [
      '  TCP    127.0.0.1:9999     0.0.0.0:0        LISTENING    11111', // wrong port
      '  TCP    127.0.0.1:8439     93.184.216.34:443 ESTABLISHED  44444', // right port, not listening
      '  TCP    127.0.0.1:8439     0.0.0.0:0        LISTENING    55555', // the one we want
    ].join('\r\n');
    expect(parseWindowsListenerPids(out, 8439)).toEqual(['55555']);
  });

  it('does not match a port that only appears as the FOREIGN address', () => {
    // 8439 is the remote port here; this row must NOT be reaped (it is our client, not our server).
    const out = '  TCP    127.0.0.1:60123    127.0.0.1:8439    ESTABLISHED    66666\r\n';
    expect(parseWindowsListenerPids(out, 8439)).toEqual([]);
  });

  it('dedupes repeated PIDs and returns empty for no matches', () => {
    const dup = [
      '  TCP    127.0.0.1:8439    0.0.0.0:0    LISTENING    77777',
      '  TCP    [::]:8439         [::]:0       LISTENING    77777',
    ].join('\r\n');
    expect(parseWindowsListenerPids(dup, 8439)).toEqual(['77777']);
    expect(parseWindowsListenerPids('no tcp rows here', 8439)).toEqual([]);
  });
});
