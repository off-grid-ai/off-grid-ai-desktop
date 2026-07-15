/**
 * Unit tests for proEnabled() — the gate deciding whether pro main-process features
 * activate. High blast radius: it decides free vs pro for the whole main process.
 *
 * Contract (per source):
 *   - __OFFGRID_PRO__ false (core build, no pro code bundled) → always false
 *   - OFFGRID_PRO === '0' → force free  (false)
 *   - OFFGRID_PRO === '1' → force pro   (true)
 *   - unset / any other value → delegate to isProEntitled()
 *
 * The dynamic-import loader body (loadProFeaturesMain) is untested shell. The module's
 * IO collaborators are mocked so the import doesn't pull Electron/DB into the unit run;
 * only isProEntitled matters here and its return is controlled per case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isProEntitled = vi.fn();

// Mock every IO collaborator the module imports so loading it stays Electron-free.
vi.mock('../../licensing/license-service', () => ({ isProEntitled: () => isProEntitled() }));
vi.mock('../../database', () => ({ getDB: vi.fn(), runMigration: vi.fn() }));
vi.mock('../../llm', () => ({ llm: {} }));
vi.mock('../../tools', () => ({ registerToolExtension: vi.fn() }));
vi.mock('../hookRegistry', () => ({ registerHook: vi.fn() }));

import { proEnabled } from '../loadProFeaturesMain';

describe('proEnabled', () => {
  beforeEach(() => {
    isProEntitled.mockReset();
    // Pro code is bundled in this test build; the free-build branch (__OFFGRID_PRO__
    // false) is a compile-time define we can't flip at runtime without a re-import.
    vi.stubGlobal('__OFFGRID_PRO__', true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('OFFGRID_PRO="0" forces free (false) without consulting the license', () => {
    vi.stubEnv('OFFGRID_PRO', '0');
    expect(proEnabled()).toBe(false);
    expect(isProEntitled).not.toHaveBeenCalled();
  });

  it('OFFGRID_PRO="1" forces pro (true) without consulting the license', () => {
    vi.stubEnv('OFFGRID_PRO', '1');
    expect(proEnabled()).toBe(true);
    expect(isProEntitled).not.toHaveBeenCalled();
  });

  it('unset env delegates to isProEntitled — true path', () => {
    vi.stubEnv('OFFGRID_PRO', undefined as unknown as string);
    isProEntitled.mockReturnValue(true);
    expect(proEnabled()).toBe(true);
    expect(isProEntitled).toHaveBeenCalledTimes(1);
  });

  it('unset env delegates to isProEntitled — false path', () => {
    vi.stubEnv('OFFGRID_PRO', undefined as unknown as string);
    isProEntitled.mockReturnValue(false);
    expect(proEnabled()).toBe(false);
    expect(isProEntitled).toHaveBeenCalledTimes(1);
  });

  it('any other value (e.g. "yes") also delegates to isProEntitled', () => {
    vi.stubEnv('OFFGRID_PRO', 'yes');
    isProEntitled.mockReturnValue(true);
    expect(proEnabled()).toBe(true);
    expect(isProEntitled).toHaveBeenCalledTimes(1);
  });

  it('win32 forces free even when the license is entitled (Pro not shipped for Windows yet)', () => {
    vi.stubEnv('OFFGRID_PRO', undefined as unknown as string);
    isProEntitled.mockReturnValue(true); // a paying user...
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      // ...still gets free on Windows, WITHOUT the license path even being consulted.
      expect(proEnabled()).toBe(false);
      expect(isProEntitled).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });

  it('win32 + OFFGRID_PRO=1 still forces pro on (contributor building the Windows pro path)', () => {
    vi.stubEnv('OFFGRID_PRO', '1');
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(proEnabled()).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
});
