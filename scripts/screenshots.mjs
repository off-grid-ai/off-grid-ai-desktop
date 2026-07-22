/* eslint-disable @typescript-eslint/explicit-function-return-type -- Playwright JavaScript harness */
// Screenshot harness: launches the built app (free/core), navigates each core
// screen, and saves PNGs to docs/screenshots/. Uses the seeded demo data.
// Re-launches between states (no reload — the SPA rewrites the URL).
//   node scripts/screenshots.mjs
import { _electron as electron } from '@playwright/test'
import { mkdirSync } from 'fs'
import {
  createEvidenceProfile,
  evidenceEnvironment,
  removeEvidenceProfile
} from './release-evidence-profile.mjs'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(profile, { seedCore = false } = {}) {
  const app = await electron.launch({
    args: ['.'],
    env: evidenceEnvironment({ profile, seedCore })
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
const onboardingProfile = createEvidenceProfile('core-onboarding')
const tourProfile = createEvidenceProfile('core-tour')
let { app, win } = await launch(onboardingProfile)
await shot(win, '08-onboarding')
await app.close()

// --- Tour (isolated profile with synthetic demo data) ---
;({ app, win } = await launch(tourProfile, { seedCore: true }))
await win.evaluate(() => localStorage.setItem('onboarding_completed', 'true'))
await app.close()
;({ app, win } = await launch(tourProfile))
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
removeEvidenceProfile(onboardingProfile)
removeEvidenceProfile(tourProfile)
console.log('done → docs/screenshots/')
