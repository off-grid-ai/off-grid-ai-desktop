/**
 * Device fingerprint for Keygen machine activation (desktop).
 *
 * A stable, random per-install identifier, persisted under userData so a
 * reinstall reuses the SAME fingerprint and reclaims its Keygen machine slot
 * instead of burning a new one (otherwise reinstallers hit the device cap and
 * get falsely blocked). It is not derived from any hardware/OS identifier, so
 * nothing identifying about the device leaves the device.
 *
 * Mirrors mobile/src/services/deviceFingerprint.ts (Keychain → userData file,
 * Web Crypto → node:crypto, Platform.OS → process.platform).
 */
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FINGERPRINT_FILE = 'device-fingerprint';

function fingerprintPath(): string {
  return join(app.getPath('userData'), FINGERPRINT_FILE);
}

let cached: string | null = null;

/** The stable fingerprint for this install, generating + persisting it once. */
export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  const file = fingerprintPath();
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (existing) {
        cached = existing;
        return cached;
      }
    }
  } catch (e) {
    console.error(`[Fingerprint] read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // 16 random bytes as hex — unique per install, not derived from hardware.
  const fp = randomBytes(16).toString('hex');
  try {
    writeFileSync(file, fp, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    // If persistence fails the fingerprint is unstable across launches, which at
    // worst consumes extra device slots — log and continue rather than block Pro.
    console.error(`[Fingerprint] persist failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  cached = fp;
  return fp;
}

/** Platform tag stored on the Keygen machine for desktop/mobile analytics. */
export function getPlatformTag(): string {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  return process.platform;
}
