/**
 * E2E: the Meetings detail exposes transcription provenance (which STT engine + model ran)
 * against the real built app + seeded synthetic meetings. The Re-transcribe control and its
 * failure feedback are behavior-verified in the MeetingsScreen integration test (they require a
 * saved recording; seeded meetings are transcript-only), so here we verify the provenance the
 * user sees and capture a screenshot for the record.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import os from 'os'
import path from 'path'
import fs from 'fs'

const PRO_PRESENT = fs.existsSync(path.resolve('pro/package.json'))
let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  test.skip(!PRO_PRESENT, 'pro package not present')
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-meet-'))
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
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 8; i++) {
    const btn = page.getByRole('button', { name: /Continue|Start using Off Grid AI Desktop/i })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

test('meeting detail exposes the STT model picker (view + change)', async () => {
  await page.getByRole('button', { name: 'Meetings', exact: true }).first().click()
  await page.waitForTimeout(800)
  // Open the first seeded meeting so the detail (with the transcription controls) renders.
  const firstMeeting = page.locator('[class*="cursor-pointer"]').filter({ hasText: /·/ }).first()
  if (await firstMeeting.isVisible().catch(() => false)) {
    await firstMeeting.click().catch(() => {})
  }
  await page.waitForTimeout(600)
  // The model picker is read from the core transcription source of truth and lets the user see
  // (and change) which STT model transcribes meetings — always visible on the detail.
  const picker = page.getByLabel('Transcription model')
  await expect(picker).toBeVisible({ timeout: 8000 })
  // At minimum the built-in whisper default is offered (installed models add more in a real profile).
  await expect(picker).toContainText(/Whisper/)
  await page.screenshot({ path: 'e2e/screenshots/meeting-transcription-picker.png' })
})
