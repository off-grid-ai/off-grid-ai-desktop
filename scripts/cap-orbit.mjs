import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
const timing = {
  wait(ms) {
    return new Promise((resolveWait) => setTimeout(resolveWait, ms))
  }
}
const profile = mkdtempSync(join(tmpdir(), 'oborbit-'))
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, OFFGRID_USER_DATA: profile, OFFGRID_PRO: '0' }
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    w.setSize(1480, 940)
    w.center()
  }
})
await timing.wait(3500)
// step 1 -> click Continue to reach the orbit (step 2)
await win
  .getByRole('button', { name: /Continue/i })
  .first()
  .click()
  .catch(() => {})
await timing.wait(2500)
await win.screenshot({ path: resolve('e2e/screenshots/orbit-step2.png') })
// measure orbit card spread
const labels = ['Image', 'Vision', 'Chat', 'Projects', 'Speech', 'Voice']
const boxes = []
for (const l of labels) {
  const b = await win
    .getByText(l, { exact: true })
    .first()
    .boundingBox()
    .catch(() => null)
  if (b) boxes.push({ l, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) })
}
let minD = Infinity
for (let i = 0; i < boxes.length; i++)
  for (let j = i + 1; j < boxes.length; j++)
    minD = Math.min(minD, Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y))
console.log('CARDS:', JSON.stringify(boxes))
console.log('MIN GAP:', Math.round(minD), 'px')
await app.close()
