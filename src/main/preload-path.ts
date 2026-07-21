import { app } from 'electron'
import { join } from 'path'

// Single source of truth for the shared preload bundle path, used by EVERY window
// (main, clipboard quick-paste popup, dictation overlay).
//
// Why not `join(__dirname, '../preload/index.js')` at each call site: window-creating
// code gets code-split by Rollup. The main entry stays in out/main/index.js (__dirname
// = out/main → '../preload' = out/preload ✓), but the clipboard/overlay creators land
// in out/main/chunks/*.js (__dirname = out/main/chunks → '../preload' = out/main/preload,
// which does NOT exist → "Cannot find module .../out/main/preload/index.js", a dead
// preload, no window.api, and a window that silently can't do anything). The bug moved
// with the chunker, not the source. Anchoring on app.getAppPath() (the project root in
// dev, app.asar when packaged) is independent of where a call site is chunked, so all
// windows load the same, real preload.

/** Pure: given the app root, the absolute path to the built preload bundle. The build
 *  emits preload to `<root>/out/preload/index.js` in both dev and packaged (asar). */
export function resolvePreloadPath(appPath: string): string {
  return join(appPath, 'out', 'preload', 'index.js')
}

/** Absolute path to the shared preload bundle, anchored on the app root. */
export function preloadPath(): string {
  return resolvePreloadPath(app.getAppPath())
}
