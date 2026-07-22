// Platform-agnostic clipboard engine: polls the OS clipboard via an injected
// bridge, dedups by content hash, persists via an injected store, and emits an
// event on each new item. No platform imports here so it runs in Electron main
// and React Native alike.
//
// Adapted from copyclip's clipboard-monitor (MIT); the OS-specific reading now
// lives behind ClipboardBridge instead of being baked in.

import type { ClipboardBridge, ClipboardItem, ClipboardRead, ClipboardStore } from './types'

export interface ClipboardEngineOptions {
  bridge: ClipboardBridge
  store: ClipboardStore
  /** Content hash (sha256 hex). Injected so the package stays dependency-free
   * (host passes node crypto on desktop, a JS impl on mobile). */
  hash: (data: Uint8Array) => string
  /** Poll interval in ms. copyclip used 500ms. */
  pollIntervalMs?: number
  /** Schedule a repeating timer. Defaults to setInterval; injectable for tests
   * or platforms with a different timer API. */
  setInterval?: (cb: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

type Listener = (item: ClipboardItem) => void

export class ClipboardEngine {
  private readonly opts: Required<Pick<ClipboardEngineOptions, 'pollIntervalMs'>> &
    ClipboardEngineOptions
  private handle: unknown = null
  private lastHash = ''
  private listeners: Listener[] = []

  constructor(options: ClipboardEngineOptions) {
    this.opts = {
      pollIntervalMs: 500,
      ...options
    }
  }

  /** Subscribe to new clipboard items. Returns an unsubscribe function. */
  onItem(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  start(): void {
    if (this.handle != null) return
    // Seed lastHash with the current clipboard so we do not re-capture what is
    // already there on startup.
    const current = this.safeRead()
    this.lastHash = current ? this.opts.hash(current.rawData) : ''

    const schedule = this.opts.setInterval ?? ((cb, ms) => setInterval(cb, ms))
    this.handle = schedule(() => this.tick(), this.opts.pollIntervalMs)
  }

  stop(): void {
    if (this.handle == null) return
    const clear = this.opts.clearInterval ?? ((h) => clearInterval(h as never))
    clear(this.handle)
    this.handle = null
  }

  /** Read the clipboard once and persist if it is new. Exposed for tests. */
  tick(): ClipboardItem | null {
    const read = this.safeRead()
    if (!read || read.rawData.length === 0) return null

    const hash = this.opts.hash(read.rawData)
    if (hash === this.lastHash) return null

    const inserted = this.opts.store.insert({
      timestamp: Date.now(),
      contentType: read.contentType,
      textContent: read.textContent,
      rawData: read.rawData,
      sourceApp: read.sourceApp ?? null,
      hash
    })
    // Only mark this content as "seen" AFTER a successful store write — if insert
    // throws, leave lastHash so the payload is retried on the next tick instead of
    // being silently dropped.
    this.lastHash = hash

    if (inserted) {
      // Isolate subscribers: a throwing listener must not escape the poll timer
      // (that can take down the Electron main process) or block other listeners.
      for (const l of this.listeners) {
        try {
          l(inserted)
        } catch (e) {
          console.error('[clipboard] onItem listener threw', e)
        }
      }
    }
    return inserted
  }

  private safeRead(): ClipboardRead | null {
    try {
      return this.opts.bridge.read()
    } catch {
      return null
    }
  }
}
