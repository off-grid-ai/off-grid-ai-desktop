/**
 * User journeys through the main-owned image job boundary. The service and its
 * observer lifecycle are production code; only the native image runtime is a
 * controlled boundary so navigation, cancellation, and failure remain deterministic.
 */
import { describe, expect, it } from 'vitest'
import {
  ImageGenerationJobService,
  type ImageGenerationJobRequest,
  type ImageGenerationRuntime
} from '../imagegen/job-service'
import type { ImageGenerationProgressContract } from '../../shared/image-generation-contract'
import type { ImageGenOutput } from '../imagegen'

interface ControlledGeneration {
  progress(progress: ImageGenerationProgressContract): void
  succeed(output: ImageGenOutput): void
  fail(error: unknown): void
}

function controlledRuntime(cancelResult = true): {
  runtime: ImageGenerationRuntime
  generation(): ControlledGeneration
  savedScopes: { path: string; request: ImageGenerationJobRequest }[]
} {
  let resolveGeneration: ((output: ImageGenOutput) => void) | null = null
  let rejectGeneration: ((error: unknown) => void) | null = null
  let reportProgress: ((progress: ImageGenerationProgressContract) => void) | null = null
  const savedScopes: { path: string; request: ImageGenerationJobRequest }[] = []

  return {
    runtime: {
      generate: (_request, onProgress) => {
        reportProgress = onProgress
        return new Promise<ImageGenOutput>((resolve, reject) => {
          resolveGeneration = resolve
          rejectGeneration = reject
        })
      },
      cancel: () => cancelResult,
      saveScope: (path, request) => savedScopes.push({ path, request })
    },
    generation: () => ({
      progress: (progress) => reportProgress?.(progress),
      succeed: (output) => resolveGeneration?.(output),
      fail: (error) => rejectGeneration?.(error)
    }),
    savedScopes
  }
}

const request: ImageGenerationJobRequest = {
  prompt: 'A green cabin rendered while navigating',
  model: 'local-image-model',
  conversationId: 'conversation-navigation',
  projectId: 'project-navigation',
  seed: 91,
  width: 512,
  height: 512,
  steps: 4
}

describe('main-owned image generation job journeys', () => {
  it('keeps one job observable while the user navigates away and returns', async () => {
    const boundary = controlledRuntime()
    const jobs = new ImageGenerationJobService(boundary.runtime)
    const firstScreen: string[] = []
    const returnedScreen: string[] = []
    const detachFirst = jobs.onChange((job) => firstScreen.push(job.phase))

    const generation = jobs.start(request)
    expect(jobs.status()).toMatchObject({
      phase: 'running',
      conversationId: request.conversationId,
      projectId: request.projectId
    })
    await expect(jobs.start(request)).rejects.toThrow('already generating')

    boundary.generation().progress({ step: 2, total: 4, secPerStep: 0.5, phase: 'sampling' })
    const progress = jobs.status().progress
    expect(progress).toEqual({ step: 2, total: 4, secPerStep: 0.5, phase: 'sampling' })
    if (progress) progress.step = 99
    expect(jobs.status().progress?.step).toBe(2)

    detachFirst()
    const detachReturned = jobs.onChange((job) => returnedScreen.push(job.phase))
    const output: ImageGenOutput = {
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      path: '/generated/image.png',
      seed: 91,
      model: 'Local image model'
    }
    boundary.generation().succeed(output)
    await expect(generation).resolves.toEqual(output)

    expect(firstScreen).not.toContain('succeeded')
    expect(returnedScreen).toContain('succeeded')
    expect(jobs.status()).toMatchObject({
      phase: 'succeeded',
      outputPath: output.path,
      error: null
    })
    expect(boundary.savedScopes).toEqual([{ path: output.path, request }])

    const refreshed: string[] = []
    jobs.onConversationUpdated(() => {
      throw new Error('closed renderer')
    })
    const detachRefresh = jobs.onConversationUpdated((conversationId) =>
      refreshed.push(conversationId)
    )
    expect(jobs.acknowledgeConversation('another-conversation')).toBe(false)
    expect(jobs.acknowledgeConversation(request.conversationId!)).toBe(true)
    expect(refreshed).toEqual([request.conversationId])
    detachRefresh()
    detachReturned()
  })

  it('cancels the active native run and reports a stable cancelled result', async () => {
    const boundary = controlledRuntime()
    const jobs = new ImageGenerationJobService(boundary.runtime)
    const phases: string[] = []
    jobs.onChange((job) => phases.push(job.phase))
    const generation = jobs.start({ prompt: 'Cancel this image' })

    expect(jobs.cancel()).toBe(true)
    expect(jobs.cancel()).toBe(false)
    boundary.generation().progress({ step: 3, total: 4, secPerStep: 0.5 })
    expect(jobs.status().progress).toBeNull()
    boundary.generation().fail(new Error('Native generation cancelled'))
    await expect(generation).rejects.toThrow('cancelled')
    expect(jobs.status()).toMatchObject({
      phase: 'cancelled',
      error: 'Native generation cancelled'
    })
    expect(phases.filter((phase) => phase === 'cancelled')).toHaveLength(2)
    expect(jobs.acknowledgeConversation('conversation-navigation')).toBe(false)
  })

  it('surfaces a native failure and stays usable when observers close abruptly', async () => {
    const boundary = controlledRuntime(false)
    const jobs = new ImageGenerationJobService(boundary.runtime)
    jobs.onChange(() => {
      throw 'renderer closed'
    })
    const generation = jobs.start({ prompt: 'A failing image' })

    expect(jobs.cancel()).toBe(false)
    boundary.generation().fail('native runtime unavailable')
    await expect(generation).rejects.toBe('native runtime unavailable')
    expect(jobs.status()).toMatchObject({
      phase: 'failed',
      error: 'native runtime unavailable',
      conversationId: null,
      projectId: null
    })
  })

  it('completes an unscoped native result without writing metadata', async () => {
    const boundary = controlledRuntime()
    const jobs = new ImageGenerationJobService(boundary.runtime)
    const generation = jobs.start({ prompt: 'An unscoped image' })
    const output: ImageGenOutput = {
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      path: '',
      seed: -1,
      model: 'Local image model'
    }

    boundary.generation().succeed(output)
    await expect(generation).resolves.toEqual(output)
    expect(jobs.status()).toMatchObject({ phase: 'succeeded', outputPath: '' })
    expect(boundary.savedScopes).toEqual([])
  })
})
