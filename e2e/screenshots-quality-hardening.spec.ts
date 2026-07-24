/**
 * PR evidence capture for the quality-hardening branch. Boots the real built app with pro
 * active + seeded demo data (TEMP profile only) and screenshots the surfaces this branch
 * touched: the Models screen (never-block fit chip), Settings -> Model pipeline controls,
 * and the Integrations screen (BYO Google OAuth client setup). Screenshots land in
 * e2e/screenshots/ for the PR body. Capture-only: navigation is best-effort and each shot is
 * validated by a human/vision pass before it goes in the PR.
 */
import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import os from 'os'
import path from 'path'
import fs from 'fs'

const PRO_PRESENT = fs.existsSync(path.resolve('pro/package.json'))
let app: ElectronApplication
let page: Page
let userDataDir: string

const shot = async (name: string): Promise<void> => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `e2e/screenshots/qh-${name}.png` })
}

const nav = async (label: string): Promise<boolean> => {
  const btn = page.getByRole('button', { name: label, exact: true }).first()
  if (!(await btn.isVisible().catch(() => false))) return false
  await btn.click().catch(() => {})
  await page.waitForTimeout(700)
  return true
}

test.beforeAll(async () => {
  test.skip(!PRO_PRESENT, 'pro package not present')
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-qh-shots-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OFFGRID_USER_DATA: userDataDir,
      OFFGRID_PRO: '1',
      OFFGRID_SEED: 'force',
      OFFGRID_SEED_PRO: 'force',
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 8; i++) {
    const btn = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  try {
    await page.getByRole('button', { name: 'Expand sidebar' }).click({ timeout: 4000 })
  } catch {
    /* already open */
  }
  await page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await app?.close()
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('capture Models screen — never-block fit chip', async () => {
  await nav('Models')
  await shot('models-fit-chip')
})

test('capture Settings — model pipeline controls', async () => {
  await nav('Settings')
  // Scroll the Model pipeline section into view if present.
  const section = page.getByText('Model pipeline', { exact: false }).first()
  if (await section.isVisible().catch(() => false)) {
    await section.scrollIntoViewIfNeeded().catch(() => {})
  }
  await shot('settings-model-pipeline')
})

test('capture Integrations — BYO Google OAuth client setup', async () => {
  const reached = (await nav('Integrations')) || (await nav('Connectors'))
  if (!reached) {
    await shot('integrations-not-reached')
    return
  }
  await shot('integrations-overview')
  // Best-effort: open the Google client setup (BYO OAuth) if an entry is present.
  for (const label of [/set up your google client/i, /google/i, /set up/i]) {
    const entry = page.getByRole('button', { name: label }).first()
    if (await entry.isVisible().catch(() => false)) {
      await entry.click().catch(() => {})
      await page.waitForTimeout(600)
      break
    }
  }
  await shot('integrations-byo-google-setup')
})

test('capture Replay — enable/disable capture control', async () => {
  // Task 4: the Replay screen carries a compact enable/disable capture control in its header,
  // sharing the same seam as the Settings Capture section (useCaptureControl).
  const reached = await nav('Replay')
  if (!reached) {
    await shot('replay-not-reached')
    return
  }
  const toggle = page.getByRole('button', { name: /capture/i }).first()
  await toggle.scrollIntoViewIfNeeded().catch(() => {})
  await shot('replay-capture-toggle')
})
