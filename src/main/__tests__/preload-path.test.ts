import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { resolvePreloadPath } from '../preload-path'

describe('resolvePreloadPath', () => {
  it('anchors on the app root, not the (chunk-dependent) __dirname', () => {
    // Dev: app root is the project dir; preload built to <root>/out/preload/index.js.
    expect(resolvePreloadPath('/Users/dev/desktop')).toBe(
      join('/Users/dev/desktop', 'out', 'preload', 'index.js')
    )
    // Packaged: app root is the asar; same out/preload layout inside it.
    expect(resolvePreloadPath('/Applications/App.app/Contents/Resources/app.asar')).toBe(
      join('/Applications/App.app/Contents/Resources/app.asar', 'out', 'preload', 'index.js')
    )
  })

  it('never resolves under out/main (the chunk bug it replaces)', () => {
    // The old `join(__dirname, "../preload")` from a out/main/chunks/*.js call site
    // produced out/main/preload/index.js — a path that does not exist. The app-root
    // anchor must never land inside out/main, regardless of app root.
    const resolved = resolvePreloadPath('/any/root')
    expect(resolved).not.toContain(join('out', 'main'))
    expect(resolved).toContain(join('out', 'preload', 'index.js'))
  })
})
