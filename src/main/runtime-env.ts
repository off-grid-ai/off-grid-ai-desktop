// Host-agnostic path/resource resolution for the gateway runtime.
//
// The runtime (llm, imagegen, tts, embeddings, active-models, model-server,
// rag/extractors, mflux) must run BOTH embedded in Electron AND standalone
// (the future @offgrid/gateway: a Node CLI / Docker image). This is the single
// seam that hides where data + bundled binaries live, so none of those modules
// import `electron` directly.
//
// Resolution order: explicit configure() → env vars → Electron `app` → cwd.
import path from 'path';

interface RuntimeConfig {
  dataDir?: string;        // writable per-user dir (models, caches, generated output)
  binRoots?: string[];     // dirs to search for bundled binaries (llama-server, ffmpeg, …)
  resourceDirs?: string[]; // dirs to search for bundled resources (tts-worker.mjs, …)
}

let cfg: RuntimeConfig = {};

/** Host calls this once at startup. Electron host passes app paths; a standalone
 *  host passes its own. Any field left out falls back to env/electron/cwd. */
export function configureRuntime(c: RuntimeConfig): void {
  cfg = { ...cfg, ...c };
}

// Lazily probe Electron without a hard dependency (so the module loads in plain Node).
function electron(): { dataDir: string; binRoots: string[]; resourceDirs: string[] } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (!app?.getPath) return null;
    const packaged = app.isPackaged;
    return {
      dataDir: app.getPath('userData'),
      binRoots: packaged
        ? [path.join(process.resourcesPath, 'bin')]
        : [path.join(app.getAppPath(), 'resources', 'bin'), path.join(process.cwd(), 'resources', 'bin')],
      resourceDirs: packaged
        ? [process.resourcesPath]
        : [path.join(app.getAppPath(), 'resources'), path.join(process.cwd(), 'resources')],
    };
  } catch {
    return null;
  }
}

/** Writable per-user data dir (models, caches, generated images, settings). */
export function dataDir(): string {
  if (cfg.dataDir) return cfg.dataDir;
  if (process.env.OFFGRID_DATA_DIR) return process.env.OFFGRID_DATA_DIR;
  const e = electron();
  if (e) return e.dataDir;
  return path.join(process.cwd(), '.offgrid');
}

/** The models directory under the data dir. */
export function modelsDir(): string {
  return path.join(dataDir(), 'models');
}

/** Dirs to search for bundled binaries (binary lives under one of these). */
export function binRoots(): string[] {
  if (cfg.binRoots?.length) return cfg.binRoots;
  if (process.env.OFFGRID_BIN_DIR) return [process.env.OFFGRID_BIN_DIR];
  const e = electron();
  if (e) return e.binRoots;
  return [path.join(process.cwd(), 'resources', 'bin')];
}

/** Append the platform executable extension to a bundled binary's base name:
 *  `.exe` on Windows, nothing on macOS/Linux. Use this at every spawn site so
 *  `llama-server` resolves to `llama-server.exe` on win32. */
export function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/** Resolve a bundled resource file by name across the resource dirs, or null. */
export function resourceFile(name: string): string | null {
  for (const d of resourceDirs()) {
    const p = path.join(d, name);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      if (require('fs').existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Whether running inside a packaged app (affects quarantine handling on macOS). */
export function isPackaged(): boolean {
  if (process.env.OFFGRID_PACKAGED) return process.env.OFFGRID_PACKAGED === '1';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return !!require('electron')?.app?.isPackaged;
  } catch {
    return false;
  }
}

/** Register a shutdown callback. In Electron, hooks 'before-quit'; standalone
 *  hosts handle process teardown themselves (no-op here). */
export function onHostQuit(fn: () => void): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('electron')?.app?.on?.('before-quit', fn);
  } catch {
    /* standalone: host owns shutdown */
  }
}

/** Dirs to search for bundled resources (e.g. tts-worker.mjs). */
export function resourceDirs(): string[] {
  if (cfg.resourceDirs?.length) return cfg.resourceDirs;
  if (process.env.OFFGRID_RESOURCE_DIR) return [process.env.OFFGRID_RESOURCE_DIR];
  const e = electron();
  if (e) return e.resourceDirs;
  return [path.join(process.cwd(), 'resources')];
}
