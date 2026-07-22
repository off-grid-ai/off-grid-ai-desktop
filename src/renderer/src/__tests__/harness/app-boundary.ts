import { vi } from 'vitest'

export const APP_PROJECTS = Array.from({ length: 12 }, (_, index) => {
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

export function installAppBoundary(overrides: Record<string, unknown> = {}): void {
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
    listProjects: async () => APP_PROJECTS.map((project) => ({ ...project })),
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

export function installAppStorage(): Storage {
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

export function installAppBrowserBoundary(): void {
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
