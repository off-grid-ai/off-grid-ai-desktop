const MAX_CONCURRENT_MODEL_DOWNLOADS = 3

export const DOWNLOAD_INTERRUPTED_ERROR = 'interrupted - retry to resume'

export type DownloadQueueState = 'queued' | 'downloading' | 'cancelled' | 'interrupted'
export type DownloadResult = { success: boolean; error?: string }

interface DownloadTask {
  modelId: string
  run: (signal: AbortSignal) => Promise<DownloadResult>
  onState: (state: DownloadQueueState) => void
  resolve: (result: DownloadResult) => void
}

/** FIFO admission for large model transfers. It owns concurrency and cancellation;
 * the model manager owns catalog resolution, bytes, integrity, and persistence. */
export class ModelDownloadQueue {
  private readonly waiting: DownloadTask[] = []
  private readonly active = new Map<string, AbortController>()
  private readonly idleWaiters = new Set<() => void>()
  private shuttingDown = false

  constructor(private readonly limit: number = MAX_CONCURRENT_MODEL_DOWNLOADS) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('download limit must be positive')
  }

  has(modelId: string): boolean {
    return this.active.has(modelId) || this.waiting.some((task) => task.modelId === modelId)
  }

  counts(): { running: number; queued: number } {
    return { running: this.active.size, queued: this.waiting.length }
  }

  isAccepting(): boolean {
    return !this.shuttingDown
  }

  enqueue(
    modelId: string,
    run: (signal: AbortSignal) => Promise<DownloadResult>,
    onState: (state: DownloadQueueState) => void
  ): Promise<DownloadResult> {
    if (this.shuttingDown) {
      return Promise.resolve({ success: false, error: DOWNLOAD_INTERRUPTED_ERROR })
    }
    if (this.has(modelId)) return Promise.resolve({ success: false, error: 'already downloading' })

    return new Promise<DownloadResult>((resolve) => {
      const task = { modelId, run, onState, resolve }
      this.waiting.push(task)
      if (this.active.size >= this.limit) onState('queued')
      this.drain()
    })
  }

  cancel(modelId: string): boolean {
    const controller = this.active.get(modelId)
    if (controller) {
      controller.abort()
      return true
    }

    const index = this.waiting.findIndex((task) => task.modelId === modelId)
    if (index < 0) return false
    const [task] = this.waiting.splice(index, 1)
    task!.onState('cancelled')
    task!.resolve({ success: false, error: 'cancelled' })
    return true
  }

  /** Close admission and settle every owned transfer before application teardown.
   * Active HTTP boundaries receive a distinct interruption reason so the model
   * manager preserves resumable bytes; explicitly cancelled downloads keep their
   * existing destructive-cancel semantics. */
  shutdown(): Promise<void> {
    if (!this.shuttingDown) {
      this.shuttingDown = true
      for (const task of this.waiting.splice(0)) {
        task.onState('interrupted')
        task.resolve({ success: false, error: DOWNLOAD_INTERRUPTED_ERROR })
      }
      for (const controller of this.active.values()) {
        controller.abort(DOWNLOAD_INTERRUPTED_ERROR)
      }
    }
    if (this.active.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  private drain(): void {
    while (this.active.size < this.limit && this.waiting.length > 0) {
      const task = this.waiting.shift()!
      const controller = new AbortController()
      this.active.set(task.modelId, controller)
      task.onState('downloading')
      void this.run(task, controller)
    }
  }

  private async run(task: DownloadTask, controller: AbortController): Promise<void> {
    let result: DownloadResult
    try {
      result = await task.run(controller.signal)
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }

    // Advance the queue before resolving the caller-visible promise. A completed
    // download therefore exposes stable running/queued counts with no microtask gap.
    this.active.delete(task.modelId)
    if (!this.shuttingDown) this.drain()
    task.resolve(result)
    if (this.shuttingDown && this.active.size === 0) {
      for (const resolve of this.idleWaiters) resolve()
      this.idleWaiters.clear()
    }
  }
}

/** The one process-wide owner used by the model manager and application shutdown. */
export const modelDownloadQueue = new ModelDownloadQueue()

export function shutdownModelDownloads(): Promise<void> {
  return modelDownloadQueue.shutdown()
}
