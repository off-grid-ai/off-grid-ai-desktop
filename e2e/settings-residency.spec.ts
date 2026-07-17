import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import type { ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

let app: ElectronApplication | null = null
let page: Page
let userDataDir: string

const launchApp = async (): Promise<void> => {
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OFFGRID_USER_DATA: userDataDir,
      OFFGRID_PRO: '0',
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

const waitForExit = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
}

const closeApp = async (): Promise<void> => {
  const running = app
  if (!running) return
  app = null
  const child = running.process()
  await running.close()
  await waitForExit(child)
}

const completeOnboarding = async (): Promise<void> => {
  for (let step = 0; step < 8; step += 1) {
    const button = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
    if (!(await button.isVisible().catch(() => false))) return
    await button.click()
  }
}

const openModelMemory = async (): Promise<void> => {
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' })
  if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click()
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await page.getByRole('button', { name: /Model memory/ }).click()
}

const persistedResidency = async (): Promise<Record<string, string>> =>
  page.evaluate(() => window.api.residencyGet())

const residencyControls = (): {
  chat: Locator
  unlocked: Locator[]
} => ({
  chat: page.getByRole('switch', { name: 'Chat model residency' }),
  unlocked: [
    page.getByRole('switch', { name: 'Image generation residency' }),
    page.getByRole('switch', { name: 'Dictation (speech-to-text) residency' }),
    page.getByRole('switch', { name: 'Text-to-speech residency' })
  ]
})

test.beforeEach(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-residency-e2e-'))
  await launchApp()
  await completeOnboarding()
})

test.afterEach(async () => {
  await closeApp()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

test('runtime residency controls persist across relaunch while chat stays required', async () => {
  await openModelMemory()

  const { chat, unlocked } = residencyControls()
  await expect(chat).toBeChecked()
  await expect(chat).toBeDisabled()
  await expect(page.getByText('in-memory (required)')).toBeVisible()

  for (const control of unlocked) {
    await expect(control).not.toBeChecked()
    await control.click()
    await expect(control).toBeChecked()
  }

  await expect
    .poll(persistedResidency)
    .toEqual({ llm: 'resident', image: 'resident', stt: 'resident', tts: 'resident' })

  await closeApp()
  await launchApp()
  await openModelMemory()

  const relaunched = residencyControls()
  await expect(relaunched.chat).toBeChecked()
  await expect(relaunched.chat).toBeDisabled()
  for (const control of relaunched.unlocked) await expect(control).toBeChecked()
  await expect(persistedResidency()).resolves.toEqual({
    llm: 'resident',
    image: 'resident',
    stt: 'resident',
    tts: 'resident'
  })
})
