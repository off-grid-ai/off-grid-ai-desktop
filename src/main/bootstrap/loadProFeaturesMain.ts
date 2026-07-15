// Loads the private pro package's MAIN-process features, if present. In the free
// build the Vite alias resolves `@offgrid/pro/main` to proStub (default null),
// so activateMain is absent and this is a no-op. Mirrors
// mobile/src/bootstrap/loadProFeatures.ts.

import { getDB, runMigration } from '../database';
import { llm } from '../llm';
import { registerHook } from './hookRegistry';
import { registerToolExtension } from '../tools';
import { isProEntitled } from '../licensing/license-service';

// What the pro main entry receives. Pro registers IPC handlers + intervals +
// tool extensions itself, using these core helpers (no core→pro imports).
export interface ProMainApi {
  getDB: typeof getDB;
  runMigration: typeof runMigration;
  llm: typeof llm;
  registerHook: typeof registerHook;
  registerToolExtension: typeof registerToolExtension;
}

/** Whether pro features should activate. The pro submodule must be present AND
 *  the user entitled by a valid Keygen license. Local env override (dev/contributor):
 *    OFFGRID_PRO=0 → force free even with pro code bundled,
 *    OFFGRID_PRO=1 → force pro on without a license (working on pro features),
 *    unset/other   → license-gated (the real paid path; see license-service). */
export function proEnabled(): boolean {
  if (!__OFFGRID_PRO__) return false; // free / core build — no pro code bundled
  if (process.env.OFFGRID_PRO === '0') return false;
  if (process.env.OFFGRID_PRO === '1') return true;
  return isProEntitled();
}

export async function loadProFeaturesMain(): Promise<void> {
  if (!proEnabled()) { console.log('[pro] disabled via OFFGRID_PRO=0'); return; }
  let pro: unknown;
  try {
    pro = await import('@offgrid/pro/main');
  } catch {
    return; // free / contributor build: package not present
  }
  const activateMain = (pro as { activateMain?: (api: ProMainApi) => void | Promise<void> }).activateMain;
  if (typeof activateMain !== 'function') return; // stub resolved to null
  try {
    await activateMain({ getDB, runMigration, llm, registerHook, registerToolExtension });
    console.log('[pro] main features activated');
  } catch (e) {
    console.error('[pro] activateMain failed', e);
  }
}
