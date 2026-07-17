/**
 * Fresh-install smoke test. Launches the REAL built Electron app against an empty
 * userData dir (the same OFFGRID_USER_DATA trick used for manual fresh-install
 * testing) and drives onboarding → app shell, asserting on the DOM. OFFGRID_PRO=0
 * forces deterministic free-tier behavior (no capture-permission gate).
 *
 * Catches the most common release-breakers: boot crash, white screen, broken
 * preload (window.api), and onboarding/routing regressions. No model download —
 * a fresh dir has no model, so llama-server never spawns (fast + offline).
 *
 * Requires a build first: `npm run build` (the test:e2e script does this).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import os from 'os'
import path from 'path'
import fs from 'fs'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OFFGRID_USER_DATA: userDataDir, // pristine first-run
      OFFGRID_PRO: '0', // deterministic free tier (no permission gate)
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app?.close()
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('boots fresh without a white screen and exposes the preload bridge', async () => {
  // Renderer mounted with real content (not a blank/crashed page).
  await expect(page.locator('#root')).not.toBeEmpty()
  // Preload contextBridge is wired.
  const hasApi = await page.evaluate(() => typeof (window as { api?: unknown }).api === 'object')
  expect(hasApi).toBe(true)
})

test('shows onboarding on a fresh install', async () => {
  await expect(page.getByText(/Off Grid/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue|Start using Off Grid/i })).toBeVisible()
})

test('onboarding surfaces the Pro capability grid', async () => {
  // Advance until the Pro step renders its capability cards, then assert a few
  // capabilities are shown by name (Replay, Meetings, Vault). Regression guard
  // for the onboarding redesign that showcases the Pro layer.
  const btn = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
  for (let i = 0; i < 6; i++) {
    if (
      await page
        .getByText('Meetings')
        .isVisible()
        .catch(() => false)
    )
      break
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await page.waitForTimeout(400)
  }
  await expect(page.getByText('Replay')).toBeVisible()
  await expect(page.getByText('Meetings')).toBeVisible()
  await expect(page.getByText('Vault')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/onboarding-pro-grid.png' })
})

test('completes onboarding and lands in the app shell', async () => {
  // Click through every onboarding step (Continue × N, then "Start using Off Grid").
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await page.waitForTimeout(400)
  }
  // Free tier defaults to the Models screen — assert the app shell rendered.
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible()
})

test('system:health IPC returns the component list', async () => {
  const health = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).api?.systemHealth?.()
  })
  expect(health).toBeTruthy()
  expect(Array.isArray(health.components)).toBe(true)
  // The chat + gateway components are always reported.
  const ids = health.components.map((c: { id: string }) => c.id)
  expect(ids).toContain('chat')
  expect(ids).toContain('gateway')
})

test('gateway /v1/models serves active local models with modality metadata', async () => {
  const modelsDir = path.join(userDataDir, 'models')
  fs.mkdirSync(modelsDir, { recursive: true })
  fs.writeFileSync(path.join(modelsDir, 'e2e-active.gguf'), 'synthetic gateway model fixture')
  fs.writeFileSync(
    path.join(modelsDir, 'active-model.json'),
    JSON.stringify({ id: 'e2e-active-model', primary: 'e2e-active.gguf', mmproj: null })
  )

  let catalog: {
    object?: string
    data?: Array<{ id?: string; object?: string; kind?: string }>
    models?: Array<{ name?: string; model?: string; kind?: string }>
  } = {}
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch('http://127.0.0.1:7878/v1/models')
          if (!response.ok) return false
          catalog = await response.json()
          return catalog.data?.some((model) => model.id === 'e2e-active-model') ?? false
        } catch {
          return false
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)

  expect(catalog.object).toBe('list')
  expect(catalog.data).toContainEqual(
    expect.objectContaining({
      id: 'e2e-active-model',
      object: 'model',
      kind: 'chat'
    })
  )
  expect(catalog.models).toContainEqual(
    expect.objectContaining({
      name: 'e2e-active-model',
      model: 'e2e-active-model',
      kind: 'chat'
    })
  )
})
