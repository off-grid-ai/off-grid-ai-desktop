// @vitest-environment jsdom
//
// RELEASE_TEST_CHECKLIST #38-#42 - chat lifecycle integration coverage.
//
// These tests mount the real MemoryChat and drive its real composer, queue, stop,
// conversation switching, project selection, stream routing, and persistence paths.
// Electron IPC and the local model runtime cannot run in jsdom, so one stateful preload
// boundary stands in for them. No Off Grid component, hook, store, or orchestration code
// is mocked.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryChat } from '../MemoryChat'
import { TooltipProvider } from '../ui/tooltip'
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type StreamEvent = { streamId: string; type: 'content' | 'reasoning' | 'step'; text?: string }
type RagResult = { answer: string; context: { unified: unknown[] } }
type StoredMessage = { id: number; role: 'user' | 'assistant'; content: string; context?: unknown }
type Conversation = {
  id: string
  title: string
  project_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class ChatBoundary {
  readonly projects = [
    { id: 'project-alpha', name: 'Project Alpha' },
    { id: 'project-beta', name: 'Project Beta' }
  ]

  readonly conversations: Conversation[] = [
    this.conversation('conversation-a', 'Conversation A', 'project-alpha'),
    this.conversation('conversation-b', 'Conversation B', null)
  ]

  readonly messages: Record<string, StoredMessage[]> = {
    'conversation-a': [],
    'conversation-b': [
      { id: 1, role: 'assistant', content: 'Conversation B baseline', context: { unified: [] } }
    ]
  }

  readonly calls: {
    query: string
    projectId: string | null | undefined
    conversationId: string
    streamId: string
    turn: ReturnType<typeof deferred<RagResult>>
  }[] = []

  private streamCallback: ((event: StreamEvent) => void) | null = null
  private nextMessageId = 10
  private pendingUserWrite: ReturnType<typeof deferred<void>> | null = null

  readonly cancelRag = vi.fn()
  readonly saveArtifact = vi.fn(async () => 'artifact-id')
  readonly addRagMessage = vi.fn(
    async (
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      context?: unknown
    ) => {
      if (role === 'user' && this.pendingUserWrite) {
        const gate = this.pendingUserWrite
        this.pendingUserWrite = null
        await gate.promise
      }
      this.messages[conversationId] ??= []
      this.messages[conversationId]!.push({
        id: this.nextMessageId++,
        role,
        content,
        context
      })
      const conversation = this.conversations.find((item) => item.id === conversationId)
      if (conversation) conversation.message_count = this.messages[conversationId]!.length
      return this.nextMessageId - 1
    }
  )

  readonly api = {
    isPro: false,
    imageGenStatus: vi.fn(async () => ({ available: false, models: [], active: '' })),
    cancelImageGen: vi.fn(),
    cancelRag: this.cancelRag,
    onImageGenProgress: vi.fn(() => () => {}),
    onRagStream: vi.fn((callback: (event: StreamEvent) => void) => {
      this.streamCallback = callback
      return () => {
        this.streamCallback = null
      }
    }),
    getRagConversations: vi.fn(async () => this.conversations.map((item) => ({ ...item }))),
    getRagConversation: vi.fn(async (id: string) => {
      const found = this.conversations.find((item) => item.id === id)
      return found ? { ...found } : null
    }),
    getRagMessages: vi.fn(async (id: string) =>
      (this.messages[id] ?? []).map((item) => ({ ...item }))
    ),
    createRagConversation: vi.fn(
      async (id: string, title = 'Untitled', projectId: string | null = null) => {
        this.conversations.unshift(this.conversation(id, title, projectId))
        this.messages[id] = []
        return id
      }
    ),
    setRagConversationProject: vi.fn(async (id: string, projectId: string | null) => {
      const conversation = this.conversations.find((item) => item.id === id)
      if (conversation) conversation.project_id = projectId
    }),
    addRagMessage: this.addRagMessage,
    saveArtifact: this.saveArtifact,
    getSettings: vi.fn(async () => ({})),
    saveSetting: vi.fn(async () => {}),
    listProjects: vi.fn(async () => this.projects.map((item) => ({ ...item }))),
    styleThumbs: vi.fn(async () => ({})),
    listSkills: vi.fn(async () => []),
    ragChat: vi.fn(
      async (
        query: string,
        _appName?: string,
        _history?: unknown[],
        projectId?: string | null,
        conversationId?: string,
        _noMemory?: boolean,
        streamId?: string
      ) => {
        const turn = deferred<RagResult>()
        this.calls.push({
          query,
          projectId,
          conversationId: conversationId!,
          streamId: streamId!,
          turn
        })
        return turn.promise
      }
    )
  }

  blockNextUserWrite(): void {
    this.pendingUserWrite = deferred<void>()
  }

  releaseUserWrite(): void {
    this.pendingUserWrite?.resolve()
  }

  emit(callIndex: number, text: string): void {
    const call = this.calls[callIndex]!
    this.streamCallback?.({ streamId: call.streamId, type: 'content', text })
  }

  resolve(callIndex: number, answer: string): void {
    this.calls[callIndex]!.turn.resolve({ answer, context: { unified: [] } })
  }

  private conversation(id: string, title: string, projectId: string | null): Conversation {
    return {
      id,
      title,
      project_id: projectId,
      created_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T00:00:00.000Z',
      message_count: 0
    }
  }
}

function installBoundary(boundary: ChatBoundary): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = boundary.api
}

function renderChat(target: {
  conversationId?: string
  projectId?: string
}): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <MemoryChat openTarget={target} />
    </TooltipProvider>
  )
}

async function send(text: string, user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const textarea = await screen.findByPlaceholderText(/^ask /i)
  await user.clear(textarea)
  await user.type(textarea, text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}

describe('<MemoryChat/> - chat lifecycle integration (#38-#42)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    }
  })

  afterEach(() => cleanup())

  it('stops before the first token and immediately permits the next turn (#38)', async () => {
    const boundary = new ChatBoundary()
    boundary.blockNextUserWrite()
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await screen.findByPlaceholderText(/project alpha/i)
    await send('cancel before the model starts', user)
    await user.click(await screen.findByRole('button', { name: /stop generating/i }))
    boundary.releaseUserWrite()

    await waitFor(() => expect(boundary.api.ragChat).not.toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull()
    )
    expect(screen.getByText('cancel before the model starts')).toBeTruthy()

    await send('the next turn still runs', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))
    boundary.resolve(0, 'The next turn completed.')

    expect(await screen.findByText('The next turn completed.')).toBeTruthy()
    expect(boundary.calls[0]!.query).toBe('the next turn still runs')
  })

  it('stops a live stream, retains its partial answer, and clears busy state (#39)', async () => {
    const boundary = new ChatBoundary()
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await send('stream a long response', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))
    boundary.emit(0, 'Partial answer')
    expect(await screen.findByText('Partial answer')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /stop generating/i }))
    expect(boundary.cancelRag).toHaveBeenCalledWith(boundary.calls[0]!.streamId)
    boundary.resolve(0, 'Partial answer')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop generating/i })).toBeNull()
      expect(
        boundary.addRagMessage.mock.calls.some(
          (call) => call[1] === 'assistant' && call[2] === 'Partial answer'
        )
      ).toBe(true)
    })
    expect(screen.queryByText('No response returned.')).toBeNull()
  })

  it('drains queued messages in send order without duplication or loss (#40)', async () => {
    const boundary = new ChatBoundary()
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await send('first question', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))
    await send('second question', user)
    expect(await screen.findByText('1 queued')).toBeTruthy()

    boundary.resolve(0, 'First answer')
    await waitFor(() => expect(boundary.calls).toHaveLength(2))
    boundary.resolve(1, 'Second answer')

    expect(await screen.findByText('First answer')).toBeTruthy()
    expect(await screen.findByText('Second answer')).toBeTruthy()
    expect(boundary.calls.map((call) => call.query)).toEqual(['first question', 'second question'])
    await waitFor(() => {
      const persisted = boundary.messages['conversation-a']!.map((message) => [
        message.role,
        message.content
      ])
      expect(persisted).toEqual([
        ['user', 'first question'],
        ['assistant', 'First answer'],
        ['user', 'second question'],
        ['assistant', 'Second answer']
      ])
    })
  })

  it('keeps conversation A stream state out of B and completes against A (#41)', async () => {
    const boundary = new ChatBoundary()
    installBoundary(boundary)
    const user = userEvent.setup()
    const view = renderChat({ conversationId: 'conversation-a' })

    await send('answer only in A', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))
    boundary.emit(0, 'A partial')
    expect(await screen.findByText('A partial')).toBeTruthy()

    view.rerender(
      <TooltipProvider>
        <MemoryChat openTarget={{ conversationId: 'conversation-b' }} />
      </TooltipProvider>
    )
    expect(await screen.findByText('Conversation B baseline')).toBeTruthy()
    expect(screen.queryByText('A partial')).toBeNull()

    boundary.emit(0, ' must stay in A')
    boundary.resolve(0, 'A completed against A history')
    await waitFor(() =>
      expect(
        boundary.addRagMessage.mock.calls.some(
          (call) =>
            call[0] === 'conversation-a' &&
            call[1] === 'assistant' &&
            call[2] === 'A completed against A history'
        )
      ).toBe(true)
    )
    expect(screen.queryByText('A completed against A history')).toBeNull()

    view.rerender(
      <TooltipProvider>
        <MemoryChat openTarget={{ conversationId: 'conversation-a' }} />
      </TooltipProvider>
    )
    expect(await screen.findByText('A completed against A history')).toBeTruthy()
    expect(boundary.calls[0]!.conversationId).toBe('conversation-a')
  })

  it('keeps a result and its artifact attributed to the project captured at send time (#42)', async () => {
    const boundary = new ChatBoundary()
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await send('build the alpha status card', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: /project alpha/i }))
    await user.click(await screen.findByRole('menuitem', { name: /project beta/i }))
    expect(await screen.findByRole('button', { name: /project beta/i })).toBeTruthy()

    boundary.resolve(0, 'Alpha result\n```html\n<div>Alpha artifact</div>\n```')

    await waitFor(() => expect(boundary.saveArtifact).toHaveBeenCalledTimes(1))
    expect(boundary.calls[0]!.projectId).toBe('project-alpha')
    expect(boundary.saveArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-a',
        projectId: 'project-alpha',
        kind: 'html',
        code: '<div>Alpha artifact</div>'
      })
    )
    expect(await screen.findByText('Alpha result')).toBeTruthy()
  })
})
