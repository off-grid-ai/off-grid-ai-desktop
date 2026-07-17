import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryChat } from '../../MemoryChat'
import { TooltipProvider } from '../../ui/tooltip'

export type StreamEvent = {
  streamId: string
  type: 'content' | 'reasoning' | 'step'
  text?: string
}
type ThinkSplitter = { push: (text: string) => void; answer: () => string }
export type ThinkSplitterFactory = (
  emit: (event: { text: string; kind: 'content' | 'reasoning' }) => void
) => ThinkSplitter
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

export class ChatBoundary {
  constructor(private readonly createSplitter?: ThinkSplitterFactory) {}

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
    noMemory: boolean
    streamId: string
    thinking: boolean
    turn: ReturnType<typeof deferred<RagResult>>
  }[] = []

  readonly speechTurns: ReturnType<typeof deferred<{ dataUrl: string }>>[] = []

  private streamCallback: ((event: StreamEvent) => void) | null = null
  private readonly rawSplitters = new Map<number, ThinkSplitter>()
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

  readonly truncateRagMessages = vi.fn(async (conversationId: string, keepCount: number) => {
    this.messages[conversationId] = (this.messages[conversationId] ?? []).slice(0, keepCount)
    const conversation = this.conversations.find((item) => item.id === conversationId)
    if (conversation) conversation.message_count = this.messages[conversationId]!.length
  })

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
    truncateRagMessages: this.truncateRagMessages,
    saveArtifact: this.saveArtifact,
    speak: vi.fn(() => {
      const turn = deferred<{ dataUrl: string }>()
      this.speechTurns.push(turn)
      return turn.promise
    }),
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
        noMemory?: boolean,
        streamId?: string,
        thinking?: boolean
      ) => {
        const turn = deferred<RagResult>()
        this.calls.push({
          query,
          projectId,
          conversationId: conversationId!,
          noMemory: noMemory ?? false,
          streamId: streamId!,
          thinking: thinking ?? false,
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

  emitReasoning(callIndex: number, text: string): void {
    const call = this.calls[callIndex]!
    this.streamCallback?.({ streamId: call.streamId, type: 'reasoning', text })
  }

  emitRaw(callIndex: number, text: string): void {
    const call = this.calls[callIndex]!
    let splitter = this.rawSplitters.get(callIndex)
    if (!splitter) {
      if (!this.createSplitter) throw new Error('Raw stream parser is not installed')
      splitter = this.createSplitter((event) => {
        this.streamCallback?.({ streamId: call.streamId, type: event.kind, text: event.text })
      })
      this.rawSplitters.set(callIndex, splitter)
    }
    splitter.push(text)
  }

  resolveRaw(callIndex: number): void {
    const answer = this.rawSplitters.get(callIndex)?.answer() ?? ''
    this.resolve(callIndex, answer)
  }

  resolve(callIndex: number, answer: string): void {
    this.calls[callIndex]!.turn.resolve({ answer, context: { unified: [] } })
  }

  reject(callIndex: number, error: unknown): void {
    this.calls[callIndex]!.turn.reject(error)
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

export function installBoundary(boundary: ChatBoundary): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = boundary.api
}

export function renderChat(target: {
  conversationId?: string
  projectId?: string
}): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <MemoryChat openTarget={target} />
    </TooltipProvider>
  )
}

export async function send(text: string, user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const textarea = await screen.findByPlaceholderText(/^ask /i)
  await user.clear(textarea)
  await user.type(textarea, text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}
