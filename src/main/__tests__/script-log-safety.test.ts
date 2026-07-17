import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

  it('isolates release evidence from inherited profiles and uses only synthetic seeders (#155)', () => {
    const modulePath = path.join(process.cwd(), 'scripts', 'release-evidence-profile.mjs')
    const probe = `
      import { createEvidenceProfile, evidenceEnvironment, removeEvidenceProfile } from ${JSON.stringify(modulePath)}
      const profile = createEvidenceProfile('integration')
      const environment = evidenceEnvironment({
        profile,
        pro: true,
        seedCore: true,
        seedPro: true,
        extra: {
          OFFGRID_USER_DATA: '/Users/private/Library/Application Support/Off Grid AI Desktop',
          OFFGRID_SEED: 'force',
          OFFGRID_SEED_PRO: 'force'
        }
      })
      let rejectedNonTemporaryProfile = false
      try {
        evidenceEnvironment({ profile: process.cwd() })
      } catch {
        rejectedNonTemporaryProfile = true
      }
      console.log(JSON.stringify({ profile, environment, rejectedNonTemporaryProfile }))
      removeEvidenceProfile(profile)
    `
    const result = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
        encoding: 'utf8',
        env: {
          ...process.env,
          OFFGRID_USER_DATA: '/Users/private/Library/Application Support/Off Grid AI Desktop',
          OFFGRID_SEED: 'force',
          OFFGRID_SEED_PRO: 'force'
        }
      })
    ) as {
      profile: string
      environment: Record<string, string>
      rejectedNonTemporaryProfile: boolean
    }

    const canonicalTemporaryRoot = fs.realpathSync(os.tmpdir())
    expect(path.dirname(result.profile)).toBe(canonicalTemporaryRoot)
    expect(path.basename(result.profile)).toMatch(/^offgrid-evidence-integration-/)
    expect(result.environment.OFFGRID_USER_DATA).toBe(result.profile)
    expect(result.environment.OFFGRID_SEED).toBe('1')
    expect(result.environment.OFFGRID_SEED_PRO).toBe('1')
    expect(result.environment.OFFGRID_PRO).toBe('1')
    expect(result.rejectedNonTemporaryProfile).toBe(true)
    expect(fs.existsSync(result.profile)).toBe(false)

    for (const screenshotScript of ['screenshots.mjs', 'screenshots-pro.mjs']) {
      const source = script(screenshotScript)
      expect(source).toContain("from './release-evidence-profile.mjs'")
      expect(source).toContain('evidenceEnvironment({')
    }
  })
})
