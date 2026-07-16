// ModelDownloader: downloads all files of a ModelEntry through a platform
// DownloadBridge, with aggregate progress, cancel, and install tracking via a
// ModelStore. Platform-agnostic; the bridge does the actual file IO.

import type { DownloadBridge, DownloadProgress, ModelEntry, ModelStore } from './types'

export class ModelDownloader {
  private aborts = new Map<string, AbortController>()
  private listeners = new Set<(p: DownloadProgress) => void>()

  constructor(
    private readonly bridge: DownloadBridge,
    private readonly store: ModelStore
  ) {}

  onProgress(cb: (p: DownloadProgress) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  isInstalled(modelId: string): boolean {
    return this.store.isInstalled(modelId)
  }

  cancel(modelId: string): void {
    this.aborts.get(modelId)?.abort()
  }

  private emit(p: DownloadProgress): void {
    for (const l of this.listeners) l(p)
  }

  async download(entry: ModelEntry): Promise<boolean> {
    const controller = new AbortController()
    this.aborts.set(entry.id, controller)
    const totalKnown = entry.files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0)
    let basePrev = 0

    try {
      for (const file of entry.files) {
        const dest = this.bridge.pathFor(file.name)
        if (await this.bridge.exists(dest, file.sizeBytes)) {
          basePrev += file.sizeBytes ?? 0
          continue
        }
        await this.bridge.download(file.url, dest, {
          signal: controller.signal,
          onProgress: (written, total) => {
            const totalBytes = totalKnown || basePrev + total
            const bytesDownloaded = basePrev + written
            this.emit({
              modelId: entry.id,
              status: 'downloading',
              bytesDownloaded,
              totalBytes,
              progress: totalBytes ? Math.min(1, bytesDownloaded / totalBytes) : 0,
              currentFile: file.name
            })
          }
        })
        basePrev += file.sizeBytes ?? 0
      }

      this.store.markInstalled(entry)
      this.emit({
        modelId: entry.id,
        status: 'completed',
        progress: 1,
        bytesDownloaded: totalKnown,
        totalBytes: totalKnown
      })
      return true
    } catch (err) {
      const aborted = controller.signal.aborted
      this.emit({
        modelId: entry.id,
        status: aborted ? 'paused' : 'failed',
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: totalKnown,
        error: aborted ? undefined : err instanceof Error ? err.message : String(err)
      })
      return false
    } finally {
      this.aborts.delete(entry.id)
    }
  }
}
