import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function script(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8')
}

describe('maintenance script output safety', () => {
  it('writes orbit evidence inside the repository instead of a public temp path', () => {
    const source = script('cap-orbit.mjs')
    expect(source).toContain("resolve('e2e/screenshots/orbit-step2.png')")
    expect(source).not.toMatch(/['"]\/tmp\//)
  })

  it('does not print model URLs, destination paths, or Slack response content', () => {
    const download = script('download-mmproj.mjs')
    const notification = script('notify-slack-release.mjs')

    expect(download).not.toMatch(/console\.(?:log|error)\([^\n]*(?:MODEL_URL|DEST_PATH)/)
    expect(notification).not.toMatch(
      /(?:console\.log|warn)\([^\n]*(?:\$\{channel\}|j\.error|j\.ts)/
    )
  })
})
