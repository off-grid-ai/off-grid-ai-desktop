import { randomUUID } from 'node:crypto'
import {
  type ImageGenerationJobContract,
  type ImageGenerationProgressContract,
  type ImageGenerationRequestContract
} from '../../shared/image-generation-contract'
import {
  cancelImageGen,
  generateImage,
  saveGeneratedImageScope,
  type ImageGenOutput
} from '../imagegen'

export type ImageGenerationJobRequest = ImageGenerationRequestContract & {
  conversationId?: string
  projectId?: string | null
}

type JobListener = (snapshot: ImageGenerationJobContract) => void
type ConversationListener = (conversationId: string) => void

export interface ImageGenerationRuntime {
  generate(
    request: ImageGenerationJobRequest,
    onProgress: (progress: ImageGenerationProgressContract) => void
  ): Promise<ImageGenOutput>
  cancel(): boolean
  saveScope(path: string, request: ImageGenerationJobRequest): void
}

const nativeImageGenerationRuntime: ImageGenerationRuntime = {
  generate: (request, onProgress) => generateImage(request, onProgress),
  cancel: () => cancelImageGen(),
  saveScope: (path, request) => saveGeneratedImageScope(path, request)
}

const idleSnapshot = (): ImageGenerationJobContract => ({
  id: null,
  phase: 'idle',
  conversationId: null,
  projectId: null,
  progress: null,
  outputPath: null,
  error: null,
  startedAt: null,
  finishedAt: null
})

/** Main-process owner for renderer-started image jobs. The native runtime remains
 * in imagegen.ts; this service adds durable identity/observation across renderer
 * navigation without introducing a second generation state machine. */
export class ImageGenerationJobService {
  private snapshot: ImageGenerationJobContract = idleSnapshot()
  private active = false
  private readonly listeners = new Set<JobListener>()
  private readonly conversationListeners = new Set<ConversationListener>()

  constructor(private readonly runtime: ImageGenerationRuntime = nativeImageGenerationRuntime) {}

  status(): ImageGenerationJobContract {
    return { ...this.snapshot, progress: this.snapshot.progress && { ...this.snapshot.progress } }
  }

  onChange(listener: JobListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onConversationUpdated(listener: ConversationListener): () => void {
    this.conversationListeners.add(listener)
    return () => this.conversationListeners.delete(listener)
  }

  async start(request: ImageGenerationJobRequest): Promise<ImageGenOutput> {
    if (this.active) {
      throw new Error('An image is already generating - please wait for it to finish.')
    }
    this.active = true
    const id = randomUUID()
    this.snapshot = {
      id,
      phase: 'running',
      conversationId: request.conversationId ?? null,
      projectId: request.projectId ?? null,
      progress: null,
      outputPath: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null
    }
    this.publish()
    console.log(
      `[image-job] ${JSON.stringify({
        event: 'started',
        id,
        conversationId: this.snapshot.conversationId,
        projectId: this.snapshot.projectId
      })}`
    )

    try {
      const result = await this.runtime.generate(request, (progress) =>
        this.updateProgress(id, progress)
      )
      if (result.path && (request.conversationId || request.projectId)) {
        try {
          this.runtime.saveScope(result.path, request)
        } catch (scopeError) {
          console.error(
            `[image-job] ${JSON.stringify({
              event: 'save-scope-failed',
              id,
              error: scopeError instanceof Error ? scopeError.message : String(scopeError)
            })}`
          )
        }
      }
      this.snapshot = {
        ...this.snapshot,
        phase: 'succeeded',
        outputPath: result.path ?? null,
        progress: null,
        finishedAt: Date.now()
      }
      this.publish()
      console.log(`[image-job] ${JSON.stringify({ event: 'succeeded', id, path: result.path })}`)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = this.snapshot.id === id && this.snapshot.phase === 'cancelled'
      this.snapshot = {
        ...this.snapshot,
        phase: cancelled ? 'cancelled' : 'failed',
        error: message,
        progress: null,
        finishedAt: Date.now()
      }
      this.publish()
      console.error(
        `[image-job] ${JSON.stringify({ event: this.snapshot.phase, id, error: message })}`
      )
      throw error
    } finally {
      this.active = false
    }
  }

  cancel(): boolean {
    if (this.snapshot.phase !== 'running') return false
    const cancelled = this.runtime.cancel()
    if (!cancelled) return false
    this.snapshot = {
      ...this.snapshot,
      phase: 'cancelled',
      progress: null,
      finishedAt: Date.now()
    }
    this.publish()
    return true
  }

  /** Called only after the renderer has persisted the generated assistant message.
   * A remounted Chat observes this and refreshes the conversation from SQLite. */
  acknowledgeConversation(conversationId: string): boolean {
    if (
      !conversationId ||
      this.snapshot.phase !== 'succeeded' ||
      this.snapshot.conversationId !== conversationId
    )
      return false
    for (const listener of this.conversationListeners) {
      try {
        listener(conversationId)
      } catch (error) {
        console.error(
          `[image-job] ${JSON.stringify({
            event: 'conversation-observer-failed',
            conversationId,
            error: error instanceof Error ? error.message : String(error)
          })}`
        )
      }
    }
    return true
  }

  private updateProgress(id: string, progress: ImageGenerationProgressContract): void {
    if (this.snapshot.id !== id || this.snapshot.phase !== 'running') return
    this.snapshot = { ...this.snapshot, progress: { ...progress } }
    this.publish()
  }

  private publish(): void {
    const snapshot = this.status()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        console.error(
          `[image-job] ${JSON.stringify({
            event: 'observer-failed',
            id: snapshot.id,
            error: error instanceof Error ? error.message : String(error)
          })}`
        )
      }
    }
  }
}

export const imageGenerationJobs = new ImageGenerationJobService()
