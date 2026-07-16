/**
 * Guards the Windows/non-Mac notice on the Pro UPGRADE (buy) screen.
 *
 * Pro is macOS-tested only for now, so a Windows/Linux user opening the buy screen
 * must be told Pro is coming soon to their device and that their purchase works today
 * on Mac + the phone app - otherwise they could buy expecting it to run locally.
 *
 * The banner is gated purely on `!isMac()` (isMac itself is unit-tested in
 * lib/__tests__/device.test.ts). This is a source-reading guard - the repo has no
 * React render harness (no jsdom/testing-library), so we assert the wiring + copy by
 * reading the component, matching the pattern in main/__tests__/extract-prompt.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/renderer/src/components/pro/UpgradeScreen.tsx'),
  'utf-8',
);

describe('UpgradeScreen - non-Mac "coming soon" notice on the buy screen', () => {
  it('imports the isMac platform helper', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bisMac\b[^}]*\}\s*from\s*'@renderer\/lib\/device'/);
  });

  it('gates the notice on !isMac()', () => {
    expect(SRC).toMatch(/!isMac\(\)\s*&&/);
  });

  it('tells the user Pro is coming soon and works on Mac + phone', () => {
    expect(SRC).toMatch(/Coming soon to your \{deviceNoun\(\)\}/);
    expect(SRC).toMatch(/macOS-tested/);
    expect(SRC).toMatch(/phone app/);
  });

  it('keeps the buy CTA on the upgrade variant (not replaced by the notice)', () => {
    // The purchase path must remain: the license is valid on Mac + phone today.
    expect(SRC).toMatch(/Get Pro/);
    expect(SRC).toMatch(/PRO_PAY_URL/);
  });

  it('follows brand voice: uses " - " not an em dash in the notice copy', () => {
    // Em dash is unambiguous - code never uses it, so scanning the block is safe.
    const block = SRC.slice(SRC.indexOf('!isMac()'), SRC.indexOf('Unlock Pro'));
    expect(block).not.toMatch(/—/);
    expect(block).toMatch(/ - /); // the brand-approved separator
  });
});
