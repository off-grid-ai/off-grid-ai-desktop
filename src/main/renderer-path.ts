import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Pure packaged renderer path, anchored to the application root rather than a
 * Rollup chunk directory. Auxiliary windows are code-split under out/main/chunks,
 * so resolving from __dirname can incorrectly produce out/main/renderer. */
export function resolveRendererHtmlPath(appPath: string): string {
  return join(appPath, 'out', 'renderer', 'index.html')
}

export function rendererHtmlPath(): string {
  const appPath = app.getAppPath()
  const resolved = resolveRendererHtmlPath(appPath)
  console.log(
    `[renderer] ${JSON.stringify({
      event: 'path-resolved',
      appPath,
      resolved,
      exists: existsSync(resolved)
    })}`
  )
  return resolved
}
