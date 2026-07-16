// Screenshot harness: launches the built app (free/core), navigates each core
// screen, and saves PNGs to docs/screenshots/. Uses the seeded demo data.
// Re-launches between states (no reload — the SPA rewrites the URL).
//   node scripts/screenshots.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(extraEnv = {}) {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OFFGRID_PRO: '0', ...extraEnv }
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
  await wait(2500)
  return { app, win }
}
const shot = async (win, name) => {
  await wait(900)
  await win.screenshot({ path: `${OUT}/${name}.png` })
  console.log('✓', name)
}
const nav = async (win, label) => {
  try {
    await win.getByRole('button', { name: label, exact: false }).first().click({ timeout: 6000 })
    await wait(1600)
  } catch (e) {
    console.error('nav fail:', label, e.message)
  }
}

// --- Onboarding (fresh temp profile → no persisted flag → onboarding shows) ---
const freshProfile = join(tmpdir(), `offgrid-shots-${process.pid}`)
let { app, win } = await launch({ OFFGRID_USER_DATA: freshProfile })
await shot(win, '08-onboarding')
await app.close()

// --- Tour (default profile: already onboarded + seeded demo data) ---
;({ app, win } = await launch())
try {
  await win.getByRole('button', { name: 'Expand sidebar' }).click({ timeout: 4000 })
} catch {
  /* open */
}
await wait(800)
await shot(win, '01-models') // free default landing
await nav(win, 'Chat')
await shot(win, '02-chat')
await nav(win, 'Projects')
await shot(win, '03-projects')
try {
  await win.getByRole('button', { name: 'Artifacts', exact: true }).first().click({ timeout: 4000 })
  await wait(1500)
  await shot(win, '09-artifacts')
} catch (e) {
  console.error('artifacts tab', e.message)
}
await nav(win, 'Integrations')
await shot(win, '05-integrations')
await nav(win, 'Gateway')
await shot(win, '06-gateway')
await nav(win, 'Day')
await shot(win, '07-pro-upgrade') // locked Pro tab → upgrade
await app.close()
console.log('done → docs/screenshots/')
