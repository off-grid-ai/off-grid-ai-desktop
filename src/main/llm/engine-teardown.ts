// Graceful → forced engine teardown, extracted from LLMService so the escalation policy is pure and
// unit-testable with fakes (no real process, no ports). The bundled llama-server can hang on
// shutdown (a GGML/Metal abort), so a single SIGTERM that we don't wait for leaves the process
// alive holding :8439 — which is why the app "can't be unloaded without a force-quit / reboot" and
// blocks LM Studio. The rule: SIGTERM, wait a grace window, and if it's still alive escalate to
// SIGKILL; report whether it actually died so the caller can confirm the port is free.

export type TeardownOutcome =
  | 'already-dead' // nothing was running
  | 'graceful' // exited on SIGTERM within the grace window
  | 'forced' // ignored SIGTERM, exited on SIGKILL
  | 'stuck' // survived even SIGKILL within the window (uninterruptible state)

export interface TeardownEffects {
  /** Is the process still running right now? */
  isAlive: () => boolean
  /** Deliver a termination signal (must not throw). */
  sendSignal: (sig: 'SIGTERM' | 'SIGKILL') => void
  /** Resolve true if the process exits within `timeoutMs`, false on timeout. */
  waitForExit: (timeoutMs: number) => Promise<boolean>
}

/** Default grace window before escalating: enough for a clean llama.cpp/Metal shutdown, short
 *  enough that an unload feels immediate and the port frees quickly. */
export const ENGINE_TEARDOWN_GRACE_MS = 3000

/**
 * Terminate an engine process, escalating SIGTERM → SIGKILL. Sends SIGTERM, waits up to `graceMs`
 * for a clean exit, and only force-kills if it's still alive. Returns what it took so the caller
 * can surface it (and treat `stuck` as "the OS couldn't reap it" — a genuinely wedged process).
 */
export async function terminateEngine(
  fx: TeardownEffects,
  graceMs: number = ENGINE_TEARDOWN_GRACE_MS
): Promise<TeardownOutcome> {
  if (!fx.isAlive()) {
    return 'already-dead'
  }
  fx.sendSignal('SIGTERM')
  if (await fx.waitForExit(graceMs)) {
    return 'graceful'
  }
  fx.sendSignal('SIGKILL')
  if (await fx.waitForExit(graceMs)) {
    return 'forced'
  }
  return 'stuck'
}
