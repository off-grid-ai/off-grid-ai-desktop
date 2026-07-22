// Composes the streaming-TTS core into a per-turn voice streamer: feed it the
// assistant's content tokens as they arrive (keyed by streamId), and it segments
// them into sentences, cleans each to speakable text, and plays them in order
// while the model is still writing. finish() flushes the trailing partial;
// stop() halts (barge-in / voice mode off / new turn). This is the seam the
// renderer wires to window.api.speak + an <audio> element; deps are injected so
// it's testable without IPC/audio.

import { createSpeechSegmenter } from './speech-segmenter'
import { createSpeechQueue, type SpeechQueue } from './speech-queue'

export interface VoiceStreamerDeps {
  /** Synthesize a speakable segment (e.g. window.api.speak). */
  synthesize: (text: string) => Promise<{ dataUrl: string }>
  /** Play a synthesized URL to completion; abort via the signal (barge-in). */
  play: (dataUrl: string, signal: AbortSignal) => Promise<void>
  /** Markdown → speakable text, applied per segment (the shared toSpeakableText). */
  clean: (text: string) => string
}

export interface VoiceStreamer {
  /** Feed a content token for a stream. Starts a fresh session on a new streamId
   *  (stopping any previous one). */
  feed: (streamId: string, text: string) => void
  /** End-of-turn: flush the trailing partial sentence so it gets spoken. */
  finish: (streamId: string) => void
  /** Halt + clear everything now. */
  stop: () => void
}

export function createVoiceStreamer(deps: VoiceStreamerDeps): VoiceStreamer {
  let active: {
    streamId: string
    segmenter: ReturnType<typeof createSpeechSegmenter>
    queue: SpeechQueue
  } | null = null

  const stop = (): void => {
    active?.queue.stop()
    active = null
  }

  const start = (streamId: string): NonNullable<typeof active> => {
    stop()
    const queue = createSpeechQueue({ synthesize: deps.synthesize, play: deps.play })
    const segmenter = createSpeechSegmenter((seg) => {
      const spoken = deps.clean(seg).trim()
      if (spoken) {
        queue.enqueue(spoken)
      }
    })
    active = { streamId, segmenter, queue }
    return active
  }

  return {
    feed: (streamId, text): void => {
      const s = active && active.streamId === streamId ? active : start(streamId)
      s.segmenter.push(text)
    },
    finish: (streamId): void => {
      if (active && active.streamId === streamId) {
        active.segmenter.flush()
      }
    },
    stop
  }
}
