/**
 * Guards the Windows/non-Mac notice on the Pro UPGRADE (buy) screen.
 *
 * Pro is macOS-tested only for now, so a Windows/Linux user opening the buy screen
 * must be told Pro is coming soon to their device and that their purchase works today
 * on Mac + the phone app - otherwise they could buy expecting it to run locally.
 *
 * The banner is gated purely on `!isMac()` (isMac itself is unit-tested in
 * lib/__tests__/device.test.ts). This is a source-reading guard - the repo has no
 * React render harness (no jsdom/testing-library), so we assert the wiring + copy by
 * reading the component, matching the pattern in main/__tests__/extract-prompt.test.ts.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/src/components/pro/UpgradeScreen.tsx'),
  'utf-8'
)

// Scope every assertion to the UPGRADE (buy) branch of the aside ternary, so a test
// can't pass if the notice or the buy CTA drifts into the coming-soon branch. The
// upgrade branch runs from the notice comment to the shared cross-sell block.
const UPGRADE_BRANCH = SRC.slice(
  SRC.indexOf('Off macOS, Pro is not yet tested'),
  SRC.indexOf('Cross-sell')
)
// The coming-soon branch is everything in the aside before the upgrade branch.
const COMINGSOON_BRANCH = SRC.slice(
  SRC.indexOf('You have Pro'),
  SRC.indexOf('Off macOS, Pro is not yet tested')
)

describe('UpgradeScreen - non-Mac "coming soon" notice on the buy screen', () => {
  it('imports the isMac platform helper', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bisMac\b[^}]*\}\s*from\s*'@renderer\/lib\/device'/)
  })

  it('scoping anchors exist (guards this test against a refactor of the variants)', () => {
    expect(UPGRADE_BRANCH.length).toBeGreaterThan(0)
    expect(COMINGSOON_BRANCH.length).toBeGreaterThan(0)
  })

  it('gates the notice on !isMac() within the upgrade branch', () => {
    expect(UPGRADE_BRANCH).toMatch(/!isMac\(\)\s*&&/)
  })

  it('tells the user Pro is coming soon and works on Mac + phone (upgrade branch)', () => {
    expect(UPGRADE_BRANCH).toMatch(/Coming soon to your \{deviceNoun\(\)\}/)
    expect(UPGRADE_BRANCH).toMatch(/macOS-tested/)
    expect(UPGRADE_BRANCH).toMatch(/phone app/)
  })

  it('keeps the buy CTA in the upgrade branch (not replaced by the notice)', () => {
    // The purchase path must remain: the license is valid on Mac + phone today.
    expect(UPGRADE_BRANCH).toMatch(/Get Pro/)
    expect(UPGRADE_BRANCH).toMatch(/PRO_PAY_URL/)
    // ...and the buy CTA must NOT have leaked into the coming-soon branch.
    expect(COMINGSOON_BRANCH).not.toMatch(/PRO_PAY_URL/)
  })

  it('follows brand voice: uses " - " not an em dash in the notice copy', () => {
    // Em dash is unambiguous - code never uses it, so scanning the block is safe.
    const notice = UPGRADE_BRANCH.slice(0, UPGRADE_BRANCH.indexOf('Unlock Pro'))
    expect(notice).not.toMatch(/—/)
    expect(notice).toMatch(/ - /) // the brand-approved separator
  })
})
