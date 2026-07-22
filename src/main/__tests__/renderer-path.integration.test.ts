import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRendererHtmlPath } from '../renderer-path'

const profiles: string[] = []

function createAppRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `offgrid-renderer-${name}-`))
  profiles.push(root)
  const renderer = path.join(root, 'out', 'renderer')
  fs.mkdirSync(renderer, { recursive: true })
  fs.writeFileSync(path.join(renderer, 'index.html'), `<title>${name}</title>`)
  return root
}

afterEach(() => {
  for (const profile of profiles.splice(0)) {
    fs.rmSync(profile, { recursive: true, force: true })
  }
})

describe('renderer HTML path service', () => {
  it('opens the real renderer entry from dev and packaged application roots', () => {
    for (const name of ['dev', 'packaged-app.asar']) {
      const appRoot = createAppRoot(name)
      fs.mkdirSync(path.join(appRoot, 'out', 'main', 'chunks'), { recursive: true })

      const resolved = resolveRendererHtmlPath(appRoot)

      expect(fs.readFileSync(resolved, 'utf8')).toBe(`<title>${name}</title>`)
      expect(resolved).not.toContain(path.join('out', 'main'))
    }
  })
})
