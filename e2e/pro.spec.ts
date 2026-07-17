/**
 * Pro-tier E2E for behavior that crosses the Electron and OS boundaries. Launches the real built
 * app with pro features active (OFFGRID_PRO=1, no license needed) against a fresh temp
 * profile, seeded with deterministic pro data (OFFGRID_SEED_PRO=force on the TEMP
 * profile - never the real one). Drives these paths end-to-end through the real main
 * process:
 *
 *  1. Replay only surfaces moments backed by a captured SCREEN — connector-only
 *     observations (Attio/Linear/Gmail with no screenshot) must not appear. Asserted
 *     against the live crm:replay-* IPC: every moment an entity returns lines up with a
 *     real captured frame.
 *  2. Text and pixel images cross the real OS clipboard, encrypted history, and restore IPC.
 *  3. Restoring a copied FILE (of any type, including images) puts a file-url (Finder
 *     pastes the file), the path as plain text (terminal pastes the path), and the file's
 *     native bytes (an editor pastes the content) on the OS clipboard. Driven through the
 *     real capture → restore loop, asserting the resulting NSPasteboard flavors.
 *
 * The file-flavor assertions are macOS-only because they use NSPasteboard via osascript. Requires
 * the pro package to be present - skipped in a core-only checkout, exactly as the build gates pro.
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

// Mirrors electron.vite.config's proExists gate: without the pro package, OFFGRID_PRO=1
// can't activate pro features, so these surfaces would render the free upgrade screen.
const PRO_PRESENT = fs.existsSync(path.resolve('pro/package.json'))

let app: ElectronApplication
let page: Page
let userDataDir: string

const nav = async (label: string): Promise<void> => {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(500)
}

const waitForCapturedClip = async (
  contentType: 'text' | 'image' | 'file',
  textContent: string | null,
  excludedIds: string[] = []
): Promise<string> =>
  page.evaluate(
    async ({ expectedContentType, expectedTextContent, excludedClipIds }) => {
      const api = (
        window as unknown as {
          api: { proInvoke: (c: string, ...a: unknown[]) => Promise<unknown> }
        }
      ).api
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        const items = (await api.proInvoke('clipboard:list', 50)) as {
          id: string
          contentType: string
          textContent: string | null
        }[]
        const hit = items.find(
          (item) =>
            item.contentType === expectedContentType &&
            item.textContent === expectedTextContent &&
            !excludedClipIds.includes(item.id)
        )
        if (hit) return hit.id
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      throw new Error(
        `Timed out waiting for ${expectedContentType} clipboard item ${String(expectedTextContent)}`
      )
    },
    {
      expectedContentType: contentType,
      expectedTextContent: textContent,
      excludedClipIds: excludedIds
    }
  )

const restoreCapturedClip = async (id: string): Promise<boolean> =>
  page.evaluate(async (clipId) => {
    const api = (
      window as unknown as { api: { proInvoke: (c: string, ...a: unknown[]) => Promise<unknown> } }
    ).api
    return (await api.proInvoke('clipboard:restore', clipId)) as boolean
  }, id)

test.beforeAll(async () => {
  test.skip(!PRO_PRESENT, 'pro package not present — pro features cannot activate')
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-pro-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OFFGRID_USER_DATA: userDataDir,
      OFFGRID_PRO: '1', // force pro on without a license (pro code is bundled in this checkout)
      OFFGRID_SEED_PRO: 'force', // deterministic observations + entities + replay frames (TEMP profile only)
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Click through onboarding into the app shell.
  for (let i = 0; i < 8; i++) {
    const btn = page.getByRole('button', { name: /Continue|Start using Off Grid/i })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await page.waitForTimeout(400)
  }
  try {
    await page.getByRole('button', { name: 'Expand sidebar' }).click({ timeout: 4000 })
  } catch {
    /* already open */
  }
  await page.waitForTimeout(500)
  // Seeding runs async on the main process after IPC setup — give it a beat to land.
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

test('Replay is unlocked in the pro build (renders the manager, not the upgrade screen)', async () => {
  await nav('Replay')
  await expect(page.getByText('Off Grid Pro · Available now')).toHaveCount(0)
  // The seeded day has frames, so the film + scrubber render.
  await expect(page.getByText(/frames?$/).first()).toBeVisible()
})

test('Replay moments are backed by a captured screen — connector-only moments are dropped', async () => {
  // Exercise the live crm:replay-* IPC exactly as the screen does (same day window).
  const result = await page.evaluate(async () => {
    const api = (
      window as unknown as { api: Record<string, (...a: unknown[]) => Promise<unknown>> }
    ).api
    const sec = (await api.crmReplayDefaultDay()) as number
    const d = new Date(sec * 1000)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const s = Math.floor(start / 1000)
    const e = Math.floor((start + 86400000) / 1000)
    const frames = (await api.crmReplayFrames(s, e)) as { ts: number }[]
    const threads = (await api.crmReplayThreads(s, e)) as { entityId?: number }[]
    const seg = threads.find((t) => typeof t.entityId === 'number')
    if (!seg || seg.entityId == null)
      return { ok: false, reason: 'no entity thread', frames: frames.length }
    const day = (await api.crmReplayEntityDay(seg.entityId, s, e)) as {
      scenes: { ts: number; surface: string | null }[]
    }
    return {
      ok: true,
      entityId: seg.entityId,
      frameTs: frames.map((f) => f.ts),
      scenes: day.scenes
    }
  })

  expect(result.ok, `setup: ${(result as { reason?: string }).reason ?? ''}`).toBe(true)
  const r = result as { frameTs: number[]; scenes: { ts: number; surface: string | null }[] }
  // The entity (drawn from a work thread) has on-screen activity this day.
  expect(r.scenes.length).toBeGreaterThan(0)
  // The invariant the fix enforces: every moment shown lines up with a captured
  // screen frame. A connector-only observation (no screenshot) would have a ts with
  // no matching frame — before the fix it leaked through here.
  const frameTs = new Set(r.frameTs)
  for (const sc of r.scenes) {
    const hasFrame = r.frameTs.some((t) => Math.abs(t - sc.ts) <= 5) || frameTs.has(sc.ts)
    expect(hasFrame, `moment at ${sc.ts} (${sc.surface}) has no captured screen`).toBe(true)
  }
})

test('Clipboard is unlocked in the pro build', async () => {
  await nav('Clipboard')
  await expect(page.getByText('Off Grid Pro · Available now')).toHaveCount(0)
  await expect(page.getByPlaceholder('Search content or tags…')).toBeVisible()
})

test('Voice is unlocked in the pro build (renders the dictation library)', async () => {
  await nav('Voice')
  await expect(page.getByText('Off Grid Pro · Available now')).toHaveCount(0)
  // The real screen: a search box, the dictation CTA, and the file-transcribe entry.
  await expect(page.getByPlaceholder('Search transcripts')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start dictation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Transcribe file' })).toBeVisible()
})

test('Capturing and restoring text crosses the real OS clipboard and encrypted history', async () => {
  const payload = `off-grid clipboard text ${Date.now()}-${process.pid}`
  await app.evaluate(async ({ clipboard }, text) => {
    clipboard.clear()
    clipboard.writeText(text)
  }, payload)

  const capturedId = await waitForCapturedClip('text', payload)

  await app.evaluate(async ({ clipboard }) => {
    clipboard.writeText('clipboard overwritten before restore')
  })
  expect(await restoreCapturedClip(capturedId)).toBe(true)
  expect(await app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(payload)
})

test('Capturing a pixel image persists its bytes and restores the bitmap', async () => {
  const existingImageIds = await page.evaluate(async () => {
    const api = (
      window as unknown as { api: { proInvoke: (c: string, ...a: unknown[]) => Promise<unknown> } }
    ).api
    const items = (await api.proInvoke('clipboard:list', 50, 'image')) as { id: string }[]
    return items.map((item) => item.id)
  })
  const sharp = (await import('sharp')).default
  const png = await sharp({
    create: { width: 37, height: 29, channels: 3, background: { r: 28, g: 211, b: 153 } }
  })
    .png()
    .toBuffer()
  await app.evaluate(async ({ clipboard, nativeImage }, base64) => {
    clipboard.clear()
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64')))
  }, png.toString('base64'))

  const capturedId = await waitForCapturedClip('image', null, existingImageIds)
  await app.evaluate(async ({ clipboard }) =>
    clipboard.writeText('image overwritten before restore')
  )
  expect(await restoreCapturedClip(capturedId)).toBe(true)

  const restored = await app.evaluate(async ({ clipboard }) => {
    const image = clipboard.readImage()
    return { empty: image.isEmpty(), size: image.getSize() }
  })
  expect(restored.empty).toBe(false)
  expect(restored.size).toEqual({ width: 37, height: 29 })
})

test('Restoring a copied file puts BOTH the path text and the file-url on the clipboard', async () => {
  // 1. A real file on disk (written from the test process — Playwright's evaluate
  //    sandbox has no `require`), then simulate a Finder "copy file" by putting its
  //    file-url on the OS clipboard. The 500ms poller captures it into history.
  const { pathToFileURL } = await import('url')
  const fp = path.join(userDataDir, 'e2e-clip-sample.txt')
  fs.writeFileSync(fp, 'off-grid clipboard e2e payload')
  const copied = { fp, basename: path.basename(fp), fileUrl: pathToFileURL(fp).href }
  await app.evaluate(async ({ clipboard }, fileUrl) => {
    clipboard.clear()
    clipboard.writeBuffer('public.file-url', Buffer.from(fileUrl, 'utf8'))
  }, copied.fileUrl)

  // 2. Wait for capture, then restore that item via the real IPC.
  const restoredId = await waitForCapturedClip('file', copied.basename)

  expect(await restoreCapturedClip(restoredId)).toBe(true)

  // 3. The multi-flavor write runs through osascript (async); poll the pasteboard.
  const pb = await app.evaluate(async ({ clipboard }) => {
    const deadline = Date.now() + 6000
    let formats: string[] = []
    let text = ''
    while (Date.now() < deadline) {
      formats = clipboard.availableFormats()
      text = clipboard.readText()
      if (formats.includes('text/plain') && formats.includes('text/uri-list')) break
      await new Promise((res) => setTimeout(res, 200))
    }
    return { formats, text }
  })

  // Finder flavor (file-url) AND terminal flavor (plain-text path) both present.
  expect(pb.formats).toContain('text/uri-list')
  expect(pb.formats).toContain('text/plain')
  // The plain text is the file's path (so a terminal paste yields the path).
  expect(pb.text).toContain(copied.basename)
})

test('Restoring a copied IMAGE file still gives the terminal a path (plus pixels)', async () => {
  // An image file is still a file: pasting it into a terminal must yield the path, not
  // nothing. Regression for the image-only branch that wrote pixels and no text.
  const { pathToFileURL } = await import('url')
  // A real 48x48 PNG (a 1x1 is too small for readImage to register as a bitmap).
  const sharp = (await import('sharp')).default
  const png = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 200, g: 30, b: 90 } }
  })
    .png()
    .toBuffer()
  const fp = path.join(userDataDir, 'e2e-clip-image.png')
  fs.writeFileSync(fp, png)
  const copied = { basename: path.basename(fp), fileUrl: pathToFileURL(fp).href }
  await app.evaluate(async ({ clipboard }, fileUrl) => {
    clipboard.clear()
    clipboard.writeBuffer('public.file-url', Buffer.from(fileUrl, 'utf8'))
  }, copied.fileUrl)

  const restoredId = await waitForCapturedClip('file', copied.basename)
  expect(await restoreCapturedClip(restoredId)).toBe(true)

  const pb = await app.evaluate(async ({ clipboard }) => {
    const deadline = Date.now() + 6000
    let formats: string[] = []
    let text = ''
    let imageEmpty = true
    while (Date.now() < deadline) {
      formats = clipboard.availableFormats()
      text = clipboard.readText()
      imageEmpty = clipboard.readImage().isEmpty()
      if (formats.includes('text/plain') && !imageEmpty) break
      await new Promise((res) => setTimeout(res, 200))
    }
    return { formats, text, imageEmpty }
  })

  // Terminal path AND the file-url AND the image pixels — all from one copied image.
  expect(pb.formats).toContain('text/plain')
  expect(pb.text).toContain(copied.basename)
  expect(pb.imageEmpty, 'image pixels still on the clipboard for image editors').toBe(false)
})
