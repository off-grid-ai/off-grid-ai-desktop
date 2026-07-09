// A broken stdout/stderr pipe must never crash the app.
//
// When the main process is launched by a parent that captures its output (an e2e harness like
// provit, a shell pipe) and that parent exits, the next write to the pipe raises EPIPE. From a
// timer-based console.log that EPIPE is emitted as an 'error' on the stdout stream with no
// listener, so it becomes an uncaught exception and Electron shows a fatal "A JavaScript error
// occurred in the main process" dialog. That modal then blocks a clean exit and keeps the
// single-instance lock held (which in turn makes the NEXT launch collide). A console write
// failing is never a reason to take down the app.
//
// Installing an 'error' listener on the stream makes the emit non-fatal (an EventEmitter throws
// on 'error' only when there is NO listener). We swallow the write error — there is nothing
// useful to do about a dead console stream, and by definition we cannot log it.

/** Attach a no-throw error handler to each console stream so a broken pipe (or any write error)
 *  can never surface as an uncaught exception. Returns the count guarded (for tests). */
export function guardConsoleStreams(streams: Array<NodeJS.EventEmitter | undefined>): number {
  let n = 0;
  for (const s of streams) {
    if (s && typeof s.on === 'function') {
      s.on('error', () => { /* swallow: a dead console stream must not crash the process */ });
      n++;
    }
  }
  return n;
}
