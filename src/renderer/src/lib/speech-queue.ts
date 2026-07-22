// Streaming TTS playback queue: enqueue speakable segments (from the segmenter),
// synthesize each and play them strictly IN ORDER, one at a time. Synthesis of the
// next segment can overlap the playback of the current one (pipelined) without
// reordering audio. stop() halts and clears — for barge-in / turn cancel. Deps are
// injected (synthesize, play) so it's testable without audio/IPC.

export interface SpeechQueueDeps {
  /** Synthesize a segment to a playable URL (e.g. window.api.speak → dataUrl). */
  synthesize: (text: string) => Promise<{ dataUrl: string }>
  /** Play a URL; resolves when playback finishes (or rejects/looping is caller's). */
  play: (dataUrl: string, signal: AbortSignal) => Promise<void>
  /** Optional: called when the queue goes idle (all enqueued audio played). */
  onIdle?: () => void
}

export interface SpeechQueue {
  enqueue: (text: string) => void
  stop: () => void
  /** True while synthesizing or playing. */
  isActive: () => boolean
}

export function createSpeechQueue(deps: SpeechQueueDeps): SpeechQueue {
  const pending: string[] = []
  let running = false
  let controller: AbortController | null = null

  const pump = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    controller = new AbortController()
    const signal = controller.signal
    try {
      while (pending.length > 0) {
        const text = pending.shift()!
        if (signal.aborted) {
          break
        }
        let dataUrl = ''
        try {
          dataUrl = (await deps.synthesize(text)).dataUrl
        } catch {
          continue // a segment that fails to synthesize is skipped, not fatal
        }
        // play() receives the signal and returns immediately if it aborted during
        // synthesis (barge-in); an empty url simply fails there and is caught.
        try {
          await deps.play(dataUrl, signal)
        } catch {
          /* playback error / aborted — move on */
        }
      }
    } finally {
      running = false
      if (!signal.aborted) {
        deps.onIdle?.()
      }
    }
  }

  return {
    enqueue: (text: string): void => {
      const t = text.trim()
      if (!t) {
        return
      }
      pending.push(t)
      void pump()
    },
    stop: (): void => {
      pending.length = 0
      controller?.abort()
    },
    isActive: (): boolean => running || pending.length > 0
  }
}
