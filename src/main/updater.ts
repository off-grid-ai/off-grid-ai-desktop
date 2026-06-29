// Auto-update via electron-updater + GitHub Releases. Checks on launch and every
// few hours; downloads in the background and installs on quit. A native
// notification fires when an update is downloaded (checkForUpdatesAndNotify).
//
// Automatic updates are user-controlled (Settings → Software update). When OFF,
// we never auto-download or auto-install-on-quit, and we skip the periodic check
// — but the user can still run a manual "Check for updates" and choose to install.
import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import { getSetting, saveSetting } from './database';

// Version of an update that finished downloading and is staged for install
// (null = none). Held in main so a window created AFTER the download finished
// (on macOS the app keeps running with zero windows) can still seed the banner
// via update:staged-version — the update:downloaded event alone only reaches
// windows that existed at download time.
let stagedVersion: string | null = null;

function autoEnabled(): boolean {
  return getSetting<boolean>('updates:auto', true); // default ON
}

// Apply the user's auto-update preference to the updater. With auto OFF nothing
// downloads or installs without an explicit user action.
function applyAutoPref(): void {
  const on = autoEnabled();
  autoUpdater.autoDownload = on;
  autoUpdater.autoInstallOnAppQuit = on;
}

export function startAutoUpdates(): void {
  applyAutoPref();

  // Apply a staged update on demand. autoInstallOnAppQuit only swaps the bundle
  // on a GRACEFUL quit — a force-kill (Activity Monitor, kill -9, killall) skips
  // it, so a fully-downloaded update can sit unapplied forever. quitAndInstall
  // forces the clean quit + relaunch + swap, so the renderer's "Restart to
  // update" button always lands the update regardless of how the app is closed.
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  // Lets a freshly-created window ask whether an update is already staged.
  ipcMain.handle('update:staged-version', () => stagedVersion);

  // Current state for the Settings UI: the running version + whether auto is on.
  ipcMain.handle('update:get-prefs', () => ({ currentVersion: app.getVersion(), auto: autoEnabled() }));

  // Toggle automatic updates. Persisted + applied live; turning it on kicks an
  // immediate background check so the user doesn't wait for the next interval.
  ipcMain.handle('update:set-auto', (_e, on: boolean) => {
    saveSetting('updates:auto', !!on);
    applyAutoPref();
    if (on) autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('[update] check failed', e));
    return autoEnabled();
  });

  // Manual "Check for updates". Resolves with a definite status the UI can show.
  // If an update exists and auto-download is OFF, we still fetch it so the user's
  // "Restart to update" banner can install it (the explicit-check implies intent).
  ipcMain.handle('update:check', () => checkForUpdates());

  autoUpdater.on('error', (e) => console.error('[update] error', e));
  autoUpdater.on('checking-for-update', () => console.log('[update] checking…'));
  autoUpdater.on('update-available', (i) => console.log('[update] available', i.version));
  autoUpdater.on('update-not-available', () => console.log('[update] up to date'));
  autoUpdater.on('update-downloaded', (i) => {
    console.log('[update] downloaded', i.version, '— will install on quit');
    stagedVersion = i.version;
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:downloaded', { version: i.version }));
  });

  // Background cadence — only when the user has automatic updates enabled.
  const check = (): void => {
    if (!autoEnabled()) return;
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('[update] check failed', e));
  };
  setTimeout(check, 10_000); // shortly after launch
  setInterval(check, 6 * 60 * 60 * 1000); // every 6 hours
}

export type UpdateCheckResult =
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'error'; error: string };

/**
 * Run a one-shot update check and resolve with a definite outcome (instead of the
 * fire-and-forget event model), so the Settings button can show a clear result.
 */
export function checkForUpdates(timeoutMs = 30_000): Promise<UpdateCheckResult> {
  // electron-updater only works in a packaged, signed app (it reads app-update.yml,
  // bundled at build time). In a dev/unpackaged run there's nothing to check
  // against, so it would silently hang to the timeout — surface the real reason
  // instead of a vague failure.
  if (!app.isPackaged) {
    return Promise.resolve({ status: 'error', error: 'Updates only work in the installed app, not a dev build.' });
  }
  return new Promise<UpdateCheckResult>((resolve) => {
    let done = false;
    const finish = (r: UpdateCheckResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      autoUpdater.removeListener('update-available', onAvail);
      autoUpdater.removeListener('update-not-available', onNone);
      autoUpdater.removeListener('error', onErr);
      resolve(r);
    };
    const onAvail = (i: { version: string }): void => {
      // Explicit check implies intent: stage the download even if auto is off.
      if (!autoUpdater.autoDownload) autoUpdater.downloadUpdate().catch((e) => console.error('[update] download failed', e));
      finish({ status: 'available', version: i.version });
    };
    const onNone = (): void => finish({ status: 'not-available', version: app.getVersion() });
    const onErr = (e: unknown): void => finish({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    autoUpdater.once('update-available', onAvail);
    autoUpdater.once('update-not-available', onNone);
    autoUpdater.once('error', onErr);
    const timer = setTimeout(() => finish({ status: 'error', error: 'Update check timed out' }), timeoutMs);
    autoUpdater.checkForUpdates().catch((e) => onErr(e));
  });
}
