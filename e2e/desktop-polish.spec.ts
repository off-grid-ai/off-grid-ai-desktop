import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

let app: ElectronApplication
let page: Page
let userDataDir: string

async function finishOnboarding(): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    const button = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
    if (!(await button.isVisible().catch(() => false))) return
    await button.click()
  }
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-desktop-polish-'))
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
  await finishOnboarding()
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

test('window resize adds collection columns while filter context remains reachable (#150)', async () => {
  const collection = page.getByRole('list', { name: 'Models available to download' })
  await expect(collection).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 760 })
  await expect
    .poll(() =>
      collection.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length
      )
    )
    .toBe(3)

  await collection.evaluate((element) => {
    const scroller = element.parentElement
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await expect(page.getByPlaceholder('Search HuggingFace…')).toBeVisible()

  await page.setViewportSize({ width: 1800, height: 900 })
  await expect
    .poll(() =>
      collection.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length
      )
    )
    .toBe(4)
})

test('keyboard navigation has a visible theme focus treatment (#151)', async () => {
  await page.locator('body').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Tab')

  const focus = await page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) return null
    const style = getComputedStyle(element)
    return {
      tag: element.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor
    }
  })
  expect(focus?.tag).toMatch(/BUTTON|A|INPUT|SELECT|TEXTAREA/)
  expect(focus?.outlineStyle).toBe('solid')
  expect(focus?.outlineWidth).toBe('2px')
  expect(focus?.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
})

test('reduced motion keeps the detail layer reachable and Escape preserves the collection (#152, #153)', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const firstCard = page.getByRole('listitem').first()
  await firstCard.getByRole('button').first().click()

  const detail = page.locator('.fixed.inset-0.z-50.flex.justify-end > div.relative')
  await expect(detail).toBeVisible()
  const transitionDuration = await detail.evaluate(
    (element) => getComputedStyle(element).transitionDuration
  )
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001)

  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Models available to download' })).toBeVisible()
})
