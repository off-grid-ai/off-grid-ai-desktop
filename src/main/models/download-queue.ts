export const MAX_CONCURRENT_MODEL_DOWNLOADS = 3

export type DownloadQueueState = 'queued' | 'downloading' | 'cancelled'
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

  constructor(private readonly limit: number = MAX_CONCURRENT_MODEL_DOWNLOADS) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('download limit must be positive')
  }

  has(modelId: string): boolean {
    return this.active.has(modelId) || this.waiting.some((task) => task.modelId === modelId)
  }

  counts(): { running: number; queued: number } {
    return { running: this.active.size, queued: this.waiting.length }
  }

  enqueue(
    modelId: string,
    run: (signal: AbortSignal) => Promise<DownloadResult>,
    onState: (state: DownloadQueueState) => void
  ): Promise<DownloadResult> {
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
    this.drain()
    task.resolve(result)
  }
}
