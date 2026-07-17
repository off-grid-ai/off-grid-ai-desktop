// @vitest-environment jsdom
//
// RELEASE_TEST_CHECKLIST #50 and #59 - desktop navigation and project-layout
// integration coverage.
//
// The real App shell and Projects screen are mounted. Electron, model health,
// and native event subscriptions are the only boundary fakes. Navigation is
// reached through real clicks and KeyboardEvents, and assertions stay on the
// rendered view and selected project.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const rendererActivation = vi.hoisted(() => ({
  load: vi.fn<() => Promise<void>>()
}))

vi.mock('../bootstrap/loadProFeaturesRenderer', () => ({
  loadProFeaturesRenderer: rendererActivation.load
}))

let App: typeof import('../App').default

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

function installBoundary(overrides: Record<string, unknown> = {}): void {
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
    getRagConversations: async () => [],
    getSettings: async () => ({}),
    onNewApproval: eventSubscription,
    onNewAction: eventSubscription,
    onUpdateDownloaded: eventSubscription,
    onReprocessProgress: eventSubscription,
    onNavigate: eventSubscription,
    onMeetingState: eventSubscription,
    onModelProgress: eventSubscription,
    proOn: eventSubscription,
    ...overrides
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

function installBrowserBoundary(): void {
  vi.stubGlobal('__OFFGRID_PRO__', false)
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
}

describe('<App/> desktop navigation integration', () => {
  beforeAll(async () => {
    // App's renderer graph includes modules that capture the preload bridge at
    // module initialization. Install that real boundary once, then keep module
    // loading outside the interaction assertion's timeout budget.
    installBoundary()
    installBrowserBoundary()
    ;({ default: App } = await import('../App'))
  }, 30_000)

  beforeEach(() => {
    vi.clearAllMocks()
    rendererActivation.load.mockResolvedValue(undefined)
    installStorage().setItem('onboarding_completed', 'true')
    window.history.replaceState(null, '', '/projects')
    installBoundary()
    installBrowserBoundary()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a dense project master-detail state through Cmd+[ and Cmd+] (#50, #59)', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Projects' }, { timeout: 5_000 })
    ).not.toBeNull()
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

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true }))
    })
    await waitFor(() => expect(screen.getAllByText('Project Beta')).toHaveLength(2))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true }))
    })
    expect(
      await screen.findByRole('heading', { name: 'Integrations' }, { timeout: 5_000 })
    ).not.toBeNull()
  })

  it('subscribes to notification routes only after Pro target hooks finish activating (#114)', async () => {
    let finishActivation: (() => void) | undefined
    rendererActivation.load.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishActivation = resolve
        })
    )
    const onNewApproval = vi.fn(() => () => {})
    const onNewAction = vi.fn(() => () => {})
    const proOn = vi.fn(() => () => {})
    installBoundary({ isPro: true, onNewApproval, onNewAction, proOn })

    render(<App />)
    await waitFor(() => expect(rendererActivation.load).toHaveBeenCalledTimes(1))
    expect(onNewApproval).not.toHaveBeenCalled()
    expect(onNewAction).not.toHaveBeenCalled()
    expect(proOn).not.toHaveBeenCalled()

    act(() => finishActivation?.())

    await waitFor(() => expect(onNewApproval).toHaveBeenCalledTimes(1))
    expect(onNewAction).toHaveBeenCalledTimes(1)
    expect(proOn).toHaveBeenCalledWith('notification:open-target', expect.any(Function))
  })
})
