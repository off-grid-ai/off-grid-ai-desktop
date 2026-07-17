// @vitest-environment jsdom
//
// RELEASE_TEST_CHECKLIST #50 and #59 - desktop navigation and project-layout
// integration coverage.
//
// The real App shell and Projects screen are mounted. Electron, model health,
// and native event subscriptions are the only boundary fakes. Navigation is
// reached through real clicks and KeyboardEvents, and assertions stay on the
// rendered view and selected project.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../components/ui/tooltip'

const PROJECTS = Array.from({ length: 12 }, (_, index) => {
  const suffix = index === 0 ? 'Alpha' : index === 1 ? 'Beta' : String(index + 1).padStart(2, '0')
  return {
    id: `project-${suffix.toLowerCase()}`,
    name: `Project ${suffix}`,
    description: '',
    systemPrompt: '',
    includeMemory: false,
    updatedAt: '2026-07-17T00:00:00.000Z'
  }
})

const CHAT_CONVERSATION = {
  id: 'release-chat',
  title: 'Release readiness',
  project_id: null,
  created_at: '2026-07-17T00:00:00.000Z',
  updated_at: '2026-07-17T00:00:00.000Z',
  message_count: 1
}

function installBoundary(): void {
  const eventSubscription = (): (() => void) => () => {}
  const values: Record<string, unknown> = {
    isPro: false,
    platform: 'darwin',
    getPermissionStatus: async () => ({
      accessibility: true,
      screenRecording: true,
      allGranted: true
    }),
    checkModelStatus: async () => ({ downloaded: true, modelsDir: '/tmp/models' }),
    systemHealth: async () => ({ ramGb: 16, components: [{ id: 'chat', status: 'ready' }] }),
    getStagedUpdateVersion: async () => null,
    meetingGetState: async () => ({
      recording: false,
      busy: false,
      platform: null,
      startedAt: 0,
      warnUntil: 0,
      error: ''
    }),
    getModelCatalog: async () => ({ kinds: ['text'], models: [] }),
    getInstalledModels: async () => [],
    getActiveModelIds: async () => [],
    listProjects: async () => PROJECTS.map((project) => ({ ...project })),
    getRagConversations: async () => [CHAT_CONVERSATION],
    getRagMessages: async (conversationId: string) =>
      conversationId === CHAT_CONVERSATION.id
        ? [
            {
              id: 1,
              role: 'assistant',
              content: 'The existing release plan is ready.',
              context: null
            }
          ]
        : [],
    getSettings: async () => ({}),
    onNewApproval: eventSubscription,
    onNewAction: eventSubscription,
    onUpdateDownloaded: eventSubscription,
    onReprocessProgress: eventSubscription,
    onNavigate: eventSubscription,
    onMeetingState: eventSubscription,
    onModelProgress: eventSubscription,
    onImageGenProgress: eventSubscription,
    onRagStream: eventSubscription
  }
  const api = new Proxy(values, {
    get(target, property: string) {
      if (property in target) return target[property]
      return async () => undefined
    }
  })
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
}

function installStorage(): Storage {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  vi.stubGlobal('localStorage', storage)
  return storage
}

describe('<App/> desktop navigation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
    installStorage().setItem('onboarding_completed', 'true')
    window.history.replaceState(null, '', '/projects')
    installBoundary()
    ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a dense project master-detail state through Cmd+[ and Cmd+] (#50, #59)', async () => {
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <App />
      </TooltipProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Projects' })).not.toBeNull()
    await Promise.all(
      PROJECTS.map((project) => screen.findByRole('button', { name: project.name }))
    )
    await user.click(await screen.findByRole('button', { name: 'Project Beta' }))
    expect(screen.getAllByText('Project Beta')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Chats' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Artifacts' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Knowledge & settings' })).not.toBeNull()

    await user.click(screen.getByTitle('Integrations'))
    expect(await screen.findByRole('heading', { name: 'Integrations' })).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true }))
    await waitFor(() => expect(screen.getAllByText('Project Beta')).toHaveLength(2))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true }))
    expect(await screen.findByRole('heading', { name: 'Integrations' })).not.toBeNull()
  })

  it('opens a visibly fresh chat through Cmd+N from the real desktop shell (#50)', async () => {
    const { default: App } = await import('../App')
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <App />
      </TooltipProvider>
    )

    await user.click(await screen.findByTitle('Chat'))
    expect(await screen.findByText('The existing release plan is ready.')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true }))

    expect(await screen.findByRole('heading', { name: 'Start a conversation' })).not.toBeNull()
    expect(screen.queryByText('The existing release plan is ready.')).toBeNull()
    expect(screen.getByPlaceholderText('Ask anything…')).not.toBeNull()
  })
})
