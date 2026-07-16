/**
 * Regression guard for the auto-updater publish target. The repo was renamed from
 * `desktop` to `off-grid-ai-desktop`; the old name only works via GitHub's 301
 * rename-redirect, and depending on that silently breaks every client's update
 * check the day a new `off-grid-ai/desktop` repo is created. Assert the publish
 * config points at the real repo name — read from source, like the prompt guards.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const yml = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8')

describe('electron-builder publish target', () => {
  it('publishes to owner off-grid-ai', () => {
    expect(yml).toMatch(/owner:\s*off-grid-ai\b/)
  })

  it('uses the current repo name, not the redirect-only old name', () => {
    expect(yml).toMatch(/repo:\s*off-grid-ai-desktop\b/)
    // The bare old name (`repo: desktop`) must not come back.
    expect(yml).not.toMatch(/^\s*repo:\s*desktop\s*$/m)
  })
})
