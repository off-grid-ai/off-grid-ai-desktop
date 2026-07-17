/**
 * Browser APIs that Chromium provides but jsdom does not.
 *
 * This boundary is installed only for DOM test environments. Product components and
 * Radix primitives remain real; the fake owns no timers or subscriptions, and its
 * lifecycle methods are deliberately inert.
 */
if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverBoundary implements ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}

    observe(_target: Element, _options?: ResizeObserverOptions): void {}

    unobserve(_target: Element): void {}

    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverBoundary
  })
}
