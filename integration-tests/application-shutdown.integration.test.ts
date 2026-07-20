import { describe, expect, it } from 'vitest'
import {
  ShutdownRegistry,
  installApplicationShutdown,
  registerCoreShutdownOwners,
  type ApplicationQuitSource
} from '../src/main/shutdown'
import { registerRuntime, shutdownRuntimes, type ManagedRuntime } from '../src/main/runtime-manager'

class QuitBoundary implements ApplicationQuitSource {
  private readonly listeners = new Set<() => void>()

  on(_event: 'before-quit', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeListener(_event: 'before-quit', listener: () => void): void {
    this.listeners.delete(listener)
  }

  emitBeforeQuit(): void {
    for (const listener of [...this.listeners]) listener()
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

interface ResourceState {
  active: boolean
  stops: number
}

function resource(trace: string[], name: string): ResourceState & { stop(): void } {
  return {
    active: true,
    stops: 0,
    stop() {
      this.active = false
      this.stops += 1
      trace.push(name)
    }
  }
}

describe('application shutdown integration', () => {
  it('emits the application quit seam and idempotently releases Core and Pro ownership', async () => {
    const trace: string[] = []
    const source = new QuitBoundary()
    const registry = new ShutdownRegistry()

    const gateway = resource(trace, 'core:gateway')
    const media = resource(trace, 'core:media')
    const runtimes = resource(trace, 'core:runtimes')
    registerCoreShutdownOwners(registry, {
      stopGateway: () => gateway.stop(),
      stopMediaServer: () => media.stop(),
      stopModelRuntimes: () => runtimes.stop()
    })

    // Clipboard and dictation stand at the OS/native boundary in production: one
    // owns a global shortcut + polling engine, the other owns a helper process.
    const clipboard = resource(trace, 'pro:clipboard-helper')
    registry.register({ name: 'pro:clipboard', shutdown: () => clipboard.stop() })

    const scheduled = resource(trace, 'pro:scheduled-work')
    const captureSubscription = resource(trace, 'pro:capture-subscription')
    const lifecycleSubscription = resource(trace, 'pro:lifecycle-subscription')
    const captureLoop = resource(trace, 'pro:capture-loop')
    const meetingLoop = resource(trace, 'pro:meeting-loop')
    const dictationHelper = resource(trace, 'pro:dictation-helper')
    const consoleLoop = resource(trace, 'pro:console-loop')
    const meetingTrayHook = resource(trace, 'pro:meeting-tray-hook')
    const tray = resource(trace, 'pro:tray')
    const recorder = resource(trace, 'pro:recorder')

    registry.register({
      name: 'pro:services',
      shutdown: async () => {
        scheduled.stop()
        captureSubscription.stop()
        lifecycleSubscription.stop()
        captureLoop.stop()
        meetingLoop.stop()
        dictationHelper.stop()
        consoleLoop.stop()
        meetingTrayHook.stop()
        tray.stop()
        recorder.stop()
      }
    })

    installApplicationShutdown(source, registry)
    expect(source.listenerCount).toBe(1)

    source.emitBeforeQuit()
    const firstResult = await registry.shutdown()
    source.emitBeforeQuit()
    const secondResult = await registry.shutdown()

    expect(firstResult).toEqual([])
    expect(secondResult).toBe(firstResult)
    expect(source.listenerCount).toBe(0)
    const ownedResources = [
      gateway,
      media,
      runtimes,
      clipboard,
      scheduled,
      captureSubscription,
      lifecycleSubscription,
      captureLoop,
      meetingLoop,
      dictationHelper,
      consoleLoop,
      meetingTrayHook,
      tray,
      recorder
    ]
    expect(ownedResources.every((owned) => !owned.active && owned.stops === 1)).toBe(true)
    expect(trace).toEqual([
      'pro:scheduled-work',
      'pro:capture-subscription',
      'pro:lifecycle-subscription',
      'pro:capture-loop',
      'pro:meeting-loop',
      'pro:dictation-helper',
      'pro:console-loop',
      'pro:meeting-tray-hook',
      'pro:tray',
      'pro:recorder',
      'pro:clipboard-helper',
      'core:runtimes',
      'core:media',
      'core:gateway'
    ])
  })

  it('immediately tears down a resource registered after quit began', async () => {
    const registry = new ShutdownRegistry()
    await registry.shutdown()
    let active = true

    registry.register({
      name: 'late-async-owner',
      shutdown: async () => {
        active = false
      }
    })

    await Promise.resolve()
    expect(active).toBe(false)
  })

  it('isolates owner failures and supports removing an owner before shutdown', async () => {
    const registry = new ShutdownRegistry()
    const expected = new Error('native stop failed')
    let removedOwnerActive = true
    let healthyOwnerActive = true
    const unregister = registry.register({
      name: 'removed',
      shutdown: () => {
        removedOwnerActive = false
      }
    })
    unregister()
    registry.register({
      name: 'failure',
      shutdown: () => {
        throw expected
      }
    })
    registry.register({
      name: 'healthy',
      shutdown: () => {
        healthyOwnerActive = false
      }
    })

    const failures = await registry.shutdown()
    expect(removedOwnerActive).toBe(true)
    expect(healthyOwnerActive).toBe(false)
    expect(failures).toEqual([{ owner: 'failure', error: expected }])
  })

  it('rejects duplicate ownership and permits manual quit-listener removal', () => {
    const registry = new ShutdownRegistry()
    registry.register({ name: 'one-owner', shutdown: () => {} })
    expect(() => registry.register({ name: 'one-owner', shutdown: () => {} })).toThrow(
      'Shutdown owner already registered: one-owner'
    )

    const source = new QuitBoundary()
    const remove = installApplicationShutdown(source, registry)
    remove()
    remove()
    expect(source.listenerCount).toBe(0)
  })

  it('stops every real managed runtime and immediately evicts late async registration', async () => {
    const evicted: string[] = []
    const runtime = (modality: ManagedRuntime['modality']): ManagedRuntime => ({
      modality,
      evict: () => {
        evicted.push(modality)
      },
      warm: () => {},
      release: () => {}
    })
    registerRuntime(runtime('llm'))
    registerRuntime(runtime('tts'))

    await shutdownRuntimes()
    registerRuntime(runtime('image'))
    await Promise.resolve()

    expect(evicted).toEqual(['tts', 'llm', 'image'])
  })
})
