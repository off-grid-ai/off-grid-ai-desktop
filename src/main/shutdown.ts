/**
 * One application-lifecycle owner for resources created by Core and Pro.
 *
 * Subsystems expose an idempotent cleanup function; the composition roots register
 * those functions here. The registry deliberately knows nothing about Electron,
 * model engines, capture, or Pro. That keeps resource policy in one place while
 * concrete teardown remains with the resource that owns it.
 */

export interface ShutdownOwner {
  readonly name: string
  shutdown(): void | Promise<void>
}

export interface ApplicationQuitSource {
  on(event: 'before-quit', listener: () => void): unknown
  removeListener(event: 'before-quit', listener: () => void): unknown
}

export interface ShutdownFailure {
  owner: string
  error: unknown
}

export class ShutdownRegistry {
  private readonly owners = new Map<string, ShutdownOwner>()
  private shutdownPromise: Promise<ShutdownFailure[]> | null = null

  register(owner: ShutdownOwner): () => void {
    if (this.shutdownPromise) {
      void Promise.resolve(owner.shutdown()).catch(() => {})
      return () => {}
    }
    if (this.owners.has(owner.name)) {
      throw new Error(`Shutdown owner already registered: ${owner.name}`)
    }
    this.owners.set(owner.name, owner)
    return () => {
      if (!this.shutdownPromise && this.owners.get(owner.name) === owner) {
        this.owners.delete(owner.name)
      }
    }
  }

  shutdown(): Promise<ShutdownFailure[]> {
    if (this.shutdownPromise) return this.shutdownPromise

    // Reverse registration order mirrors construction order: Pro resources stop
    // before the Core runtimes and sockets they may still be using.
    const owners = [...this.owners.values()].reverse()
    this.owners.clear()
    // Invoke every owner before the first asynchronous yield. Electron does not
    // wait for before-quit promises, so helper kills, listener removal, and socket
    // close must all be initiated in the listener's original call stack.
    const stops = owners.map((owner) => {
      try {
        return Promise.resolve(owner.shutdown())
          .then<ShutdownFailure | null>(() => null)
          .catch((error): ShutdownFailure => ({ owner: owner.name, error }))
      } catch (error) {
        return Promise.resolve<ShutdownFailure | null>({ owner: owner.name, error })
      }
    })
    this.shutdownPromise = Promise.all(stops).then((results) =>
      results.filter((failure): failure is ShutdownFailure => failure !== null)
    )
    return this.shutdownPromise
  }
}

export interface CoreShutdownResources {
  stopGateway(): void | Promise<void>
  stopMediaServer(): void | Promise<void>
  stopModelRuntimes(): void | Promise<void>
  stopModelDownloads(): void | Promise<void>
}

/** Register Core resources in construction order. The registry reverses this on
 * shutdown so model workers stop before their host sockets disappear. */
export function registerCoreShutdownOwners(
  registry: ShutdownRegistry,
  resources: CoreShutdownResources
): void {
  registry.register({ name: 'core:model-gateway', shutdown: resources.stopGateway })
  registry.register({ name: 'core:media-server', shutdown: resources.stopMediaServer })
  registry.register({ name: 'core:model-runtimes', shutdown: resources.stopModelRuntimes })
  registry.register({ name: 'core:model-downloads', shutdown: resources.stopModelDownloads })
}

/** Connect the registry to the real Electron quit seam. The subscription removes
 * itself before cleanup starts, so repeated quit emission cannot create duplicate
 * work and no lifecycle listener survives teardown. */
export function installApplicationShutdown(
  source: ApplicationQuitSource,
  registry: ShutdownRegistry,
  reportFailure: (failure: ShutdownFailure) => void
): () => void {
  let installed = true
  const remove = (): void => {
    if (!installed) return
    installed = false
    source.removeListener('before-quit', listener)
  }
  const listener = (): void => {
    remove()
    void registry.shutdown().then((failures) => failures.forEach(reportFailure))
  }
  source.on('before-quit', listener)
  return remove
}

export const applicationShutdown = new ShutdownRegistry()
