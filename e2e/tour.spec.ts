/**
 * Tight navigation tour. Piggybacks the screenshot harness's launch/nav pattern
 * (scripts/screenshots.mjs) but ASSERTS each screen + the surfaces this session
 * added, instead of saving PNGs. Runs against a FRESH temp profile (never the
 * real one) and only navigates / reads — no destructive clicks — so it's safe.
 * OFFGRID_PRO=0 forces deterministic free-tier UI.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import os from 'os';
import path from 'path';
import fs from 'fs';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const nav = async (label: string): Promise<void> => {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(500);
};

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-tour-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, OFFGRID_USER_DATA: userDataDir, OFFGRID_PRO: '0', NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Click through onboarding into the app shell.
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole('button', { name: /Continue|Start using Off Grid/i });
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click();
    await page.waitForTimeout(400);
  }
  // Expand the sidebar so nav items have visible labels.
  try { await page.getByRole('button', { name: 'Expand sidebar' }).click({ timeout: 4000 }); } catch { /* already open */ }
  await page.waitForTimeout(500);
});

test.afterAll(async () => {
  await app?.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('Models: merged tab + use-cases + import', async () => {
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Import \.gguf/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coding', exact: true })).toBeVisible(); // use-case chip
});

test('Settings: setup, resource modes, storage, data & privacy all render', async () => {
  await nav('Settings');
  // Sections are collapsed accordions — the titles (headings) are always visible;
  // expand a card to reveal its body before asserting the body content.
  await expect(page.getByRole('heading', { name: 'Setup & health' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible();

  await page.getByRole('button', { name: /Setup & health/ }).click(); // expand
  await expect(page.getByText('Configure it for me')).toBeVisible();
  // The resource-mode selector now lives inside the Configure card.
  for (const m of ['Conservative', 'Balanced', 'Extreme']) {
    // The mode button's accessible name includes its description, so match by substring.
    await expect(page.getByRole('button', { name: m }).first()).toBeVisible();
  }

  await page.getByRole('button', { name: /Data & privacy/ }).click(); // expand
  await expect(page.getByText('Screen captures')).toBeVisible();
  await expect(page.getByText('Your data on this device')).toBeVisible();
});

test('Resource mode is selectable (Conservative)', async () => {
  // Ensure the Setup & health accordion is expanded (the modes live in its body).
  const cons = page.getByRole('button', { name: 'Conservative' }).first();
  if (!(await cons.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Setup & health/ }).click();
  }
  await cons.click();
  await expect(cons).toHaveAttribute('aria-pressed', 'true');
});

test('Clipboard is a Pro tab in the core build (shows upgrade)', async () => {
  // Clipboard moved to Pro: in the core/free tour (OFFGRID_PRO=0) the tab is
  // locked and renders the upgrade screen, not the clipboard manager/settings.
  // (Locked items carry a "Pro" lock label, so match by prefix, not exact.)
  await page.getByRole('button', { name: /Clipboard/ }).first().click();
  await page.waitForTimeout(500);
  await expect(page.getByText('Off Grid Pro · Available now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clipboard' })).toBeVisible();
});

test('Gateway screen renders', async () => {
  await nav('Settings'); // leave the clipboard upgrade screen first
  await nav('Gateway');
  await expect(page.getByText(/OpenAI-compatible/i).first()).toBeVisible();
});
