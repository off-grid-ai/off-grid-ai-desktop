// Cross-platform "kill an orphaned server still holding OUR port" helper. Three
// bundled servers (llama, whisper, sd) each spawned on a fixed port and each had a
// copy of this — llm.ts's was cross-platform, whisper-server/sd-server's were
// posix-only, so on Windows a crashed whisper/sd server was never reaped and held
// the port after a restart. Defined ONCE here (cross-platform), matched by process
// name so we only ever kill a server we recognize (the port is ours by convention,
// not reservation — never SIGKILL an unrelated app that happened to bind it).

import { execSync } from 'child_process';

/** Parse `netstat -ano -p tcp` output for the PIDs LISTENING on `port`. Handles both
 *  IPv4 (`127.0.0.1:8439`) and IPv6 (`[::]:8439`, `[::1]:8439`) local-address rows: the
 *  pattern anchors the captured port to the LISTENING+PID tail, so the leftmost full match
 *  is always the local port (never the `:1` inside `::1`, nor the foreign `:0`). Exported
 *  for the regression test — the win32 branch itself can't run in-process. */
export function parseWindowsListenerPids(netstatOutput: string, port: number): string[] {
  const pids = new Set<string>();
  for (const line of netstatOutput.split(/\r?\n/)) {
    // "  TCP    127.0.0.1:8439   0.0.0.0:0   LISTENING   12345"
    // "  TCP    [::1]:8439       [::]:0      LISTENING   12345"
    const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m && m[1] === String(port) && m[2]) pids.add(m[2]);
  }
  return [...pids];
}

/** Kill any process holding `port` that `matches` (a crashed/previous instance of one
 *  of our servers). Cross-platform: netstat/tasklist/taskkill on Windows, lsof/ps on
 *  macOS+Linux. `matches` receives the process command line (posix `ps`, full path) or
 *  image name (win32 `tasklist`) — the caller decides how strict to be per platform, so
 *  the port is only ever reclaimed from a server we recognize, never an unrelated app.
 *  `label` is only for logging. Returns the count killed; never throws (missing tool /
 *  empty port is a no-op). */
export function killOrphansOnPort(port: number, matches: (procInfo: string) => boolean, label = 'server'): number {
  let killed = 0;
  try {
    if (process.platform === 'win32') {
      const pids = parseWindowsListenerPids(execSync('netstat -ano -p tcp', { encoding: 'utf-8' }), port);
      for (const pid of pids) {
        let img = '';
        try { img = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8' }); } catch { continue; /* gone */ }
        if (!matches(img)) {
          console.warn(`[orphan] port ${port} held by non-${label} PID ${pid} — leaving it alone`);
          continue;
        }
        try { execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' }); killed++; console.log(`[orphan] killed orphaned ${label} ${pid} on port ${port}`); } catch { /* gone */ }
      }
    } else {
      const pids = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        let cmd = '';
        try { cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' }).trim(); } catch { continue; /* already gone */ }
        if (!matches(cmd)) {
          console.warn(`[orphan] port ${port} held by non-${label} process ${pid} (${cmd.slice(0, 80)}) — leaving it alone`);
          continue;
        }
        try { process.kill(Number(pid), 'SIGKILL'); killed++; console.log(`[orphan] killed orphaned ${label} ${pid} on port ${port}`); } catch { /* gone */ }
      }
    }
  } catch { /* nothing on the port */ }
  return killed;
}
