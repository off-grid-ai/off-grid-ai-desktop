/**
 * Pro entitlement, backed by Keygen license keys (desktop).
 *
 * Identity model: no login, no RevenueCat in the app. The buyer pays on the web
 * (RevenueCat checkout), the issuance Worker emails them a license key, and they
 * paste it into the app. We validate the key against Keygen (which enforces the
 * device cap), cache { isPro, key, expiry } on disk (encrypted via safeStorage),
 * and re-validate when online so a revoked or expired key locks the app. Offline,
 * the cached state stands until a monthly key's expiry passes (lifetime keys
 * never expire); revocation is caught at the next online check.
 *
 * Mirrors mobile/src/services/proLicenseService.ts. Differences:
 *  - storage: Keychain → userData/license.json, encrypted with Electron safeStorage
 *  - the cached entitlement is held in-memory so the gate (proEnabled) and the
 *    preload `pro:is-enabled` sync IPC can read it WITHOUT async, and a change
 *    notifier pushes updates to the renderer instead of mutating a Zustand store.
 */
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateKey,
  activateMachine,
  listMachines,
  deactivateMachine,
  KeygenNetworkError,
  type KeygenMachine,
} from './keygen-client';
import { getDeviceFingerprint, getPlatformTag } from './device-fingerprint';

const LICENSE_FILE = 'license.json';

// Public web pay page (RevenueCat checkout). "Get Pro" opens this; the buyer is
// emailed a license key by the issuance Worker and enters it via activateProByKey.
export const PRO_PAY_PAGE_URL = 'https://getoffgridai.co/pay';

export type ActivateResult = { ok: true } | { ok: false; reason: 'invalid' | 'limit' | 'network' };

export type ProLicense = {
  isPro: boolean;
  key: string | null;
  licenseId: string | null;
  expiry: string | null; // ISO timestamp, or null for a perpetual (lifetime) key
  verifiedAt: number;
};

const EMPTY: ProLicense = { isPro: false, key: null, licenseId: null, expiry: null, verifiedAt: 0 };

export const REVOKED_CODES = ['EXPIRED', 'SUSPENDED', 'BANNED', 'OVERDUE', 'NOT_FOUND'];
export const NEEDS_ACTIVATION = ['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH'];

type ProTier = 'lifetime' | 'monthly';
export interface ProLicenseInfo {
  isPro: boolean;
  tier: ProTier | null; // lifetime (no expiry) vs monthly (has expiry); null when not Pro
  expiry: string | null;
  verifiedAt: number;
}

// In-memory mirror of the on-disk license, loaded by init() at boot. Drives the
// SYNCHRONOUS isProEntitled() so the pro gate and preload don't await disk/network.
let cache: ProLicense = EMPTY;

// Pushed to the renderer on any entitlement change (set by the IPC layer).
let notifyChange: ((info: ProLicenseInfo) => void) | null = null;
export function setLicenseChangeNotifier(fn: (info: ProLicenseInfo) => void): void {
  notifyChange = fn;
}

function licensePath(): string {
  return join(app.getPath('userData'), LICENSE_FILE);
}

/** Whether the cached license grants Pro right now (offline-safe, synchronous). */
export function isProActive(lic: ProLicense): boolean {
  if (!lic.isPro) return false;
  // Monthly keys carry an expiry — once it passes, no Pro even offline. Lifetime
  // keys have null expiry. Revocation propagates at the next online revalidate.
  if (lic.expiry && Date.parse(lic.expiry) <= Date.now()) return false;
  return true;
}

export function toInfo(lic: ProLicense): ProLicenseInfo {
  const isPro = isProActive(lic);
  return {
    isPro,
    tier: !isPro ? null : lic.expiry ? 'monthly' : 'lifetime',
    expiry: lic.expiry,
    verifiedAt: lic.verifiedAt,
  };
}

function readLicenseFromDisk(): ProLicense {
  const file = licensePath();
  try {
    if (!existsSync(file)) return EMPTY;
    const raw = readFileSync(file, 'utf8');
    const wrapper = JSON.parse(raw) as { enc: boolean; data: string };
    const json = wrapper.enc
      ? safeStorage.decryptString(Buffer.from(wrapper.data, 'base64'))
      : wrapper.data;
    const p = JSON.parse(json);
    return {
      isPro: p.isPro ?? false,
      key: p.key ?? null,
      licenseId: p.licenseId ?? null,
      expiry: p.expiry ?? null,
      verifiedAt: p.verifiedAt ?? 0,
    };
  } catch (e) {
    console.error(`[Pro] readLicense failed: ${e instanceof Error ? e.message : String(e)}`);
    return EMPTY;
  }
}

function writeLicense(lic: ProLicense): void {
  cache = lic;
  try {
    const json = JSON.stringify(lic);
    const canEncrypt = safeStorage.isEncryptionAvailable();
    const wrapper = canEncrypt
      ? { enc: true, data: safeStorage.encryptString(json).toString('base64') }
      : { enc: false, data: json };
    writeFileSync(licensePath(), JSON.stringify(wrapper), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error(`[Pro] writeLicense failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  notifyChange?.(toInfo(lic));
}

/** Load the cached license into memory. Call once after app 'ready'. */
export function initLicensing(): void {
  cache = readLicenseFromDisk();
  console.log(`[Pro] license loaded — entitled=${isProActive(cache)}`);
}

/** SYNCHRONOUS entitlement check used by the pro gate and preload sync IPC. */
export function isProEntitled(): boolean {
  return isProActive(cache);
}

/** Cached license details for the Settings/Pro status UI (offline-safe). */
export function getProLicenseInfo(): ProLicenseInfo {
  return toInfo(cache);
}

/** Returns the cached entitlement immediately and revalidates in the background.
 *  @public — scaffolded paid-product entry point (revalidate-on-check); intentional,
 *  wired when launch-time revalidation is enabled. Keeps revalidatePro reachable. */
export function checkProStatus(): boolean {
  revalidatePro().catch(() => {});
  return isProActive(cache);
}

/**
 * Re-check the stored key with Keygen when online. A revoked or expired key flips
 * the cached flag to false and locks the app. Network errors are swallowed so
 * offline users keep cached access.
 */
async function revalidatePro(): Promise<void> {
  const lic = cache;
  if (!lic.key) return; // nothing to revalidate (empty cache)
  let fp: string;
  try {
    fp = await getDeviceFingerprint();
  } catch {
    return;
  }
  try {
    const r = await validateKey(lic.key, fp);
    if (r.valid && r.code === 'VALID') {
      writeLicense({
        isPro: true,
        key: lic.key,
        licenseId: r.license?.id ?? lic.licenseId,
        expiry: r.license?.expiry ?? null,
        verifiedAt: Date.now(),
      });
    } else if (REVOKED_CODES.includes(r.code)) {
      writeLicense({ ...lic, isPro: false, expiry: r.license?.expiry ?? lic.expiry, verifiedAt: Date.now() });
    } else if (NEEDS_ACTIVATION.includes(r.code) && r.license) {
      // Valid key but this device lost its slot — try to reclaim it.
      const act = await activateMachine(lic.key, r.license.id, { fingerprint: fp, platform: getPlatformTag() });
      writeLicense({
        isPro: act.ok,
        key: lic.key,
        licenseId: r.license.id,
        expiry: r.license.expiry,
        verifiedAt: Date.now(),
      });
    }
    // TOO_MANY_MACHINES / UNKNOWN: leave the cached state untouched.
  } catch (e) {
    if (e instanceof KeygenNetworkError) return; // offline — keep cached access
    console.error(`[Pro] revalidate error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Activate a license key on this device: validate, claim a device slot if
 * needed (Keygen enforces the device cap), and cache the entitlement.
 */
export async function activateProByKey(rawKey: string): Promise<ActivateResult> {
  const key = rawKey.trim();
  if (!key) return { ok: false, reason: 'invalid' };
  let fp: string;
  try {
    fp = await getDeviceFingerprint();
  } catch {
    return { ok: false, reason: 'network' };
  }

  let r;
  try {
    r = await validateKey(key, fp);
  } catch {
    return { ok: false, reason: 'network' };
  }

  // Already activated on this device.
  if (r.valid && r.code === 'VALID' && r.license) {
    writeLicense({ isPro: true, key, licenseId: r.license.id, expiry: r.license.expiry, verifiedAt: Date.now() });
    return { ok: true };
  }
  if (r.code === 'TOO_MANY_MACHINES') return { ok: false, reason: 'limit' };
  if (REVOKED_CODES.includes(r.code) || !r.license) return { ok: false, reason: 'invalid' };

  // Valid key, this device not yet activated — claim a slot.
  if (NEEDS_ACTIVATION.includes(r.code)) {
    let act;
    try {
      act = await activateMachine(key, r.license.id, { fingerprint: fp, platform: getPlatformTag() });
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (act.limitReached) return { ok: false, reason: 'limit' };
    if (!act.ok) return { ok: false, reason: 'invalid' };
    writeLicense({ isPro: true, key, licenseId: r.license.id, expiry: r.license.expiry, verifiedAt: Date.now() });
    return { ok: true };
  }
  return { ok: false, reason: 'invalid' };
}

/** Devices registered on the active license (for the device-management screen). */
export async function listProDevices(): Promise<KeygenMachine[]> {
  const lic = cache;
  if (!lic.key || !lic.licenseId) return [];
  try {
    return await listMachines(lic.key, lic.licenseId);
  } catch {
    return [];
  }
}

/** Free a device slot. */
export async function deactivateProDevice(machineId: string): Promise<boolean> {
  const lic = cache;
  if (!lic.key) return false;
  try {
    return await deactivateMachine(lic.key, machineId);
  } catch {
    return false;
  }
}

/** Drop the cached license (sign-out / testing). */
export function clearPro(): void {
  writeLicense({ ...EMPTY });
}
