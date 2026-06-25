// Smoke test for a BUILT/packaged Off Grid AI app (assertion-based).
// Launches the app on an isolated profile, drives onboarding, and asserts every
// core screen renders + the onboarding orbit isn't collapsed.
//
//   APP_BIN="/Volumes/Off Grid AI 0.0.18-arm64/Off Grid AI.app/Contents/MacOS/Off Grid AI" \
//   node scripts/smoke-test.mjs
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const APP_BIN = process.env.APP_BIN;
if (!APP_BIN) { console.error('Set APP_BIN to the packaged app executable'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'ogsmoke-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };

const app = await electron.launch({
  executablePath: APP_BIN,
  args: [],
  env: { ...process.env, OFFGRID_USER_DATA: profile, OFFGRID_PRO: '0' },
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1480, 940); w.center(); } });
await wait(3500);

const text = async () => (await win.locator('body').innerText().catch(() => '')) || '';

try {
  // 1) Onboarding shows on a fresh profile
  const onboardingText = await text();
  ok('onboarding screen appears', /Continue|Every model|Private AI|Off Grid/i.test(onboardingText));

  // 2) Onboarding orbit isn't collapsed — the modality cards are spread out
  const labels = ['Image', 'Vision', 'Chat', 'Projects', 'Speech', 'Voice'];
  const boxes = [];
  for (const l of labels) {
    const b = await win.getByText(l, { exact: true }).first().boundingBox().catch(() => null);
    if (b) boxes.push({ l, x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  let minDist = Infinity;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const d = Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y);
    if (d < minDist) minDist = d;
  }
  ok(`onboarding orbit cards spaced (${boxes.length} cards, min gap ${Math.round(minDist)}px > 40)`, boxes.length >= 4 && minDist > 40);

  // 3) Click through onboarding into the app
  for (let i = 0; i < 4; i++) {
    const btn = win.getByRole('button', { name: /Continue|Start using Off Grid/i }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await wait(1200); } else break;
  }
  await wait(1500);
  const appText = await text();

  // 4) No hard "Setup Required" wall in the core build
  ok('no "Setup Required" wall (core build)', !/Setup Required/i.test(appText));

  // 5) Lands in the app (Models is the free default)
  ok('lands on Models screen', /Models|Download models/i.test(appText));

  // 6) Core screens render
  const nav = async (label, expect) => {
    try {
      await win.getByRole('button', { name: label, exact: false }).first().click({ timeout: 5000 });
      await wait(1400);
      return expect.test(await text());
    } catch { return false; }
  };
  ok('Chat renders', await nav('Chat', /Start a conversation|Ask anything|New chat/i));
  ok('Projects renders', await nav('Projects', /Projects|New chat|knowledge/i));
  ok('Gateway renders', await nav('Gateway', /Gateway|127\.0\.0\.1:7878|OpenAI/i));
  ok('Integrations renders', await nav('Integrations', /Integrations|Connect a tool|Connect/i));
} catch (e) {
  fail++; console.error('  ✗ exception:', e.message);
} finally {
  await app.close();
}

console.log(`\nSMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
