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
  await expect(page.getByRole('heading', { name: 'Setup & health' })).toBeVisible();
  await expect(page.getByText('Configure it for me')).toBeVisible();
  // The resource-mode selector now lives inside the Configure card.
  for (const m of ['Conservative', 'Balanced', 'Extreme']) {
    // The mode button's accessible name includes its description, so match by substring.
    await expect(page.getByRole('button', { name: m }).first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible();
  await expect(page.getByText('Screen captures')).toBeVisible();
  await expect(page.getByText('Your data on this device')).toBeVisible();
});

test('Resource mode is selectable (Conservative)', async () => {
  const cons = page.getByRole('button', { name: 'Conservative' }).first();
  await cons.click();
  await expect(cons).toHaveAttribute('aria-pressed', 'true');
});

test('Clipboard: hotkey hint + its own settings screen', async () => {
  await nav('Clipboard');
  await expect(page.getByText('⌘⇧C', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clipboard settings' }).click();
  await expect(page.getByRole('heading', { name: 'Clipboard settings' })).toBeVisible();
  await expect(page.getByText('Keep history for')).toBeVisible();
  await expect(page.getByText('Maximum items')).toBeVisible();
});

test('Gateway screen renders', async () => {
  await nav('Settings'); // leave clipboard settings first
  await nav('Gateway');
  await expect(page.getByText(/OpenAI-compatible/i).first()).toBeVisible();
});
