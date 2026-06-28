// Auto-update via electron-updater + GitHub Releases. Checks on launch and every
// few hours; downloads in the background and installs on quit. A native
// notification fires when an update is downloaded (checkForUpdatesAndNotify).
import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

// Version of an update that finished downloading and is staged for install
// (null = none). Held in main so a window created AFTER the download finished
// (on macOS the app keeps running with zero windows) can still seed the banner
// via update:staged-version — the update:downloaded event alone only reaches
// windows that existed at download time.
let stagedVersion: string | null = null;

export function startAutoUpdates(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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

  autoUpdater.on('error', (e) => console.error('[update] error', e));
  autoUpdater.on('checking-for-update', () => console.log('[update] checking…'));
  autoUpdater.on('update-available', (i) => console.log('[update] available', i.version));
  autoUpdater.on('update-not-available', () => console.log('[update] up to date'));
  autoUpdater.on('update-downloaded', (i) => {
    console.log('[update] downloaded', i.version, '— will install on quit');
    stagedVersion = i.version;
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:downloaded', { version: i.version }));
  });

  const check = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('[update] check failed', e));
  };
  setTimeout(check, 10_000); // shortly after launch
  setInterval(check, 6 * 60 * 60 * 1000); // every 6 hours
}
