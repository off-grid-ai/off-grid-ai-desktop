// Central model management — the single source of truth for catalog, install
// listing, download (pull), delete, and activation. Used by BOTH the desktop IPC
// handlers (UI) AND the headless gateway HTTP admin endpoints, so the full
// repertoire (pull / delete / activate / list) works with or without a UI.
import fs from 'fs';
import path from 'path';
import { llm } from './llm';
import { getAllActiveModals, setActiveModal as setModal, modalityForKind, type Modality } from './active-models';

export interface DownloadProgress {
  modelId: string;
  percent?: number;
  status?: 'downloading' | 'completed' | 'failed' | 'cancelled';
  currentFile?: string;
  downloadedMB?: string;
  totalMB?: string;
  error?: string;
}
export type ProgressCb = (p: DownloadProgress) => void;

const controllers = new Map<string, AbortController>();
const lastProgress = new Map<string, DownloadProgress>();

function activeModelFile(): string {
  return path.join(llm.getModelsDir(), 'active-model.json');
}

export async function getCatalog(): Promise<{ kinds: readonly string[]; models: unknown[] }> {
  const { CATALOG, MODEL_KINDS } = await import('@offgrid/models');
  const dir = llm.getModelsDir();
  // Surface imported local models at the top of the catalog so they're visible
  // and activatable, tagged "Imported". Only include ones whose file still exists.
  const locals = getLocalModels()
    .filter((lm) => { try { return fs.statSync(path.join(dir, lm.primary)).size > 0; } catch { return false; } })
    .map((lm) => ({
      id: lm.id, name: lm.name, kind: lm.kind, org: 'Local', params: lm.params,
      tags: ['Imported'], files: [{ name: lm.primary, url: '', sizeBytes: lm.sizeBytes }],
    }));
  return { kinds: MODEL_KINDS, models: [...locals, ...CATALOG] };
}

/** Catalog ids (plus imported local ids) whose files are fully present on disk. */
export async function listInstalled(): Promise<string[]> {
  const { CATALOG } = await import('@offgrid/models');
  const { isMfluxModelCached } = await import('./mflux');
  const dir = llm.getModelsDir();
  const catalog = CATALOG.filter((m) => {
    if (m.runtime === 'mflux') return isMfluxModelCached(m.id);
    return m.files.length > 0 && m.files.every((f) => {
      try { return fs.statSync(path.join(dir, f.name)).size > 0; } catch { return false; }
    });
  }).map((m) => m.id);
  const locals = getLocalModels()
    .filter((lm) => { try { return fs.statSync(path.join(dir, lm.primary)).size > 0; } catch { return false; } })
    .map((lm) => lm.id);
  return [...locals, ...catalog];
}

export async function searchModels(query: string, kind?: string): Promise<unknown[]> {
  try {
    const { searchHuggingFace } = await import('@offgrid/models');
    return await searchHuggingFace(query, { limit: 30, kind: kind as never });
  } catch (err) {
    console.error('[models] HF search failed:', err);
    return [];
  }
}

export function downloadStatus(modelId: string): DownloadProgress | null {
  return lastProgress.get(modelId) ?? null;
}

export function cancelDownload(modelId: string): boolean {
  const c = controllers.get(modelId);
  if (c) { c.abort(); return true; }
  return false;
}

/** Download a catalog entry or any Hugging Face repo id. Progress via callback
 *  AND a status registry (so a headless poller can read it). */
export async function downloadModel(modelId: string, onProgress?: ProgressCb): Promise<{ success: boolean; error?: string }> {
  const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
  const entry = CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId));
  if (!entry) return { success: false, error: 'unknown model' };

  const dir = llm.getModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  ensureRegistryLoaded();
  const send = (data: Partial<DownloadProgress>): void => {
    const p: DownloadProgress = { modelId, ...data };
    lastProgress.set(modelId, p);
    onProgress?.(p);
    // Persist on terminal transitions and at the start so an interrupted download
    // is recoverable after a restart; skip the high-frequency progress ticks.
    if (p.status && p.status !== 'downloading') persistRegistry();
  };
  send({ status: 'downloading', percent: 0 });
  persistRegistry();

  const controller = new AbortController();
  controllers.set(modelId, controller);

  if (entry.runtime === 'mflux') {
    try {
      const { downloadMfluxModel } = await import('./mflux');
      await downloadMfluxModel(modelId, (pct: number) => send({ percent: pct, status: 'downloading' }));
      send({ percent: 100, status: 'completed' });
      return { success: true };
    } catch (err) {
      send({ status: 'failed', error: (err as Error).message });
      return { success: false, error: (err as Error).message };
    } finally {
      controllers.delete(modelId);
    }
  }

  try {
    for (const file of entry.files) {
      const dest = path.join(dir, file.name);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
      const partPath = `${dest}.part`;
      // Resume from a partial .part if one exists (e.g. download interrupted by a
      // quit/crash) via an HTTP Range request, so we don't re-fetch GBs.
      let resumeFrom = 0;
      try { if (fs.existsSync(partPath)) resumeFrom = fs.statSync(partPath).size; } catch { /* fresh */ }
      const res = await fetch(file.url, {
        signal: controller.signal,
        headers: resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : undefined,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${file.name}`);
      // Server honored the range (206) → append; otherwise (200) start over.
      const append = resumeFrom > 0 && res.status === 206;
      const remaining = Number(res.headers.get('content-length') ?? 0);
      const total = (append ? resumeFrom : 0) + remaining;
      const out = fs.createWriteStream(partPath, append ? { flags: 'a' } : {});
      let written = append ? resumeFrom : 0;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.write(Buffer.from(value));
          written += value.length;
          send({
            currentFile: file.name,
            percent: total ? Math.round((written / total) * 100) : 0,
            downloadedMB: (written / 1048576).toFixed(1),
            totalMB: total ? (total / 1048576).toFixed(1) : '?',
            status: 'downloading',
          });
        }
      } finally {
        out.end();
        await new Promise<void>((r) => out.on('finish', () => r()));
      }
      if (controller.signal.aborted) { fs.rmSync(partPath, { force: true }); break; }
      fs.renameSync(partPath, dest);
    }
    if (controller.signal.aborted) { send({ status: 'cancelled' }); return { success: false, error: 'cancelled' }; }
    send({ percent: 100, status: 'completed' });
    return { success: true };
  } catch (err) {
    if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
      send({ status: 'cancelled' });
      return { success: false, error: 'cancelled' };
    }
    send({ status: 'failed', error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  } finally {
    controllers.delete(modelId);
  }
}

/** Delete a model's files from disk. Clears it as active if it was selected. */
export async function deleteModel(modelId: string): Promise<{ success: boolean; error?: string; freedFiles?: number }> {
  const dir = llm.getModelsDir();
  // Imported local model: remove its files + registry entry, clear if active.
  if (modelId.startsWith('local:')) {
    const list = getLocalModels();
    const lm = list.find((m) => m.id === modelId);
    if (!lm) return { success: false, error: 'unknown local model' };
    let freedLocal = 0;
    for (const name of [lm.primary, lm.mmproj].filter(Boolean) as string[]) {
      try { fs.rmSync(path.join(dir, name), { force: true }); freedLocal++; } catch { /* ignore */ }
    }
    saveLocalModels(list.filter((m) => m.id !== modelId));
    if (getActiveModel() === modelId) {
      try { fs.rmSync(activeModelFile(), { force: true }); } catch { /* ignore */ }
      llm.reloadModel();
    }
    return { success: true, freedFiles: freedLocal };
  }
  const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
  const entry = CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId));
  if (!entry) return { success: false, error: 'unknown model' };
  let freed = 0;

  if (entry.runtime === 'mflux') {
    try {
      const mod = await import('./mflux');
      const del = (mod as Record<string, unknown>).deleteMfluxModel;
      if (typeof del === 'function') await (del as (id: string) => Promise<void>)(modelId);
    } catch (e) { console.warn('[models] mflux delete', e); }
  } else {
    for (const f of entry.files) {
      try { fs.rmSync(path.join(dir, f.name), { force: true }); freed++; } catch { /* ignore */ }
      try { fs.rmSync(path.join(dir, `${f.name}.part`), { force: true }); } catch { /* ignore */ }
    }
  }

  // If this was the active chat model, clear the selection so we don't point at gone files.
  if (getActiveModel() === modelId) {
    try { fs.rmSync(activeModelFile(), { force: true }); } catch { /* ignore */ }
    llm.reloadModel();
  }
  // Clear any per-modality selection pointing at it.
  const modals = getAllActiveModals();
  (Object.keys(modals) as Modality[]).forEach((k) => {
    if (modals[k] === modelId) setModal(k, null);
  });
  return { success: true, freedFiles: freed };
}

/** Set the chat LLM (text/vision). Writes active-model.json + reloads llama-server. */
export async function setActiveModel(modelId: string): Promise<{ success: boolean; error?: string }> {
  // Imported local model: resolve from the local registry (not the catalog).
  if (modelId.startsWith('local:')) {
    const lm = getLocalModels().find((m) => m.id === modelId);
    if (!lm) return { success: false, error: 'unknown local model' };
    fs.writeFileSync(activeModelFile(), JSON.stringify({ id: modelId, primary: lm.primary, mmproj: lm.mmproj ?? null }, null, 2));
    llm.reloadModel();
    return { success: true };
  }
  const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
  const entry = CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId));
  if (!entry) return { success: false, error: 'unknown model' };
  if (entry.kind !== 'text' && entry.kind !== 'vision') {
    return { success: false, error: `${entry.kind} models are not loadable as the chat LLM` };
  }
  const primary = (entry.files.find((f) => f.role === 'primary') ?? entry.files[0])?.name;
  const mmproj = entry.files.find((f) => f.role === 'mmproj')?.name ?? null;
  fs.writeFileSync(activeModelFile(), JSON.stringify({ id: modelId, primary, mmproj }, null, 2));
  llm.reloadModel();
  return { success: true };
}

export function getActiveModel(): string | null {
  try {
    return JSON.parse(fs.readFileSync(activeModelFile(), 'utf-8')).id ?? null;
  } catch {
    return null;
  }
}

/**
 * The active model id for EVERY modality (chat LLM + image/voice/transcription),
 * as catalog/local ids. The single "what's active" truth the UI consults so it
 * can mark any model active without re-deriving per-kind rules. Reuses the
 * per-entry active computation in getStorageInfo (one definition of "active").
 */
export async function getActiveModelIds(): Promise<string[]> {
  const info = await getStorageInfo();
  return info.models.filter((m) => m.active).map((m) => m.id);
}

/**
 * Make ANY installed model the active one for its type — the single seam the UI
 * calls. Routes by kind internally: text/vision load the chat LLM; image/voice/
 * transcription set that modality's default pick. Callers pass only the id and
 * never branch on kind. Adding a new modality needs zero caller changes.
 */
export async function activateModel(modelId: string): Promise<{ success: boolean; error?: string }> {
  let kind: string | undefined;
  if (modelId.startsWith('local:')) {
    kind = getLocalModels().find((m) => m.id === modelId)?.kind;
  } else {
    const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
    kind = (CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId)))?.kind;
  }
  const modal = modalityForKind(kind);
  return modal ? setActiveModalChoice(modal, modelId) : setActiveModel(modelId);
}

export async function setActiveModalChoice(kind: string, modelId: string | null): Promise<{ success: boolean; error?: string }> {
  if (kind === 'image' || kind === 'speech' || kind === 'transcription') {
    let stored = modelId;
    // The image resolver loads by FILENAME, but the UI passes a catalog id — map it
    // to the entry's primary filename so an in-app pick (e.g. Juggernaut) takes effect.
    if (modelId && kind === 'image') {
      try {
        const { CATALOG } = await import('@offgrid/models');
        const e = CATALOG.find((m) => m.id === modelId);
        const fname = (e?.files?.find((f) => f.role === 'primary') ?? e?.files?.[0])?.name;
        if (fname) stored = fname;
      } catch { /* keep modelId as-is */ }
    }
    setModal(kind as Modality, stored);
    return { success: true };
  }
  return { success: false, error: 'use setActiveModel for the chat LLM (text/vision)' };
}

export function getActiveModalities(): { text: string | null } & Record<Modality, string | null> {
  return { text: getActiveModel(), ...getAllActiveModals() };
}

// ---------------------------------------------------------------------------
// Local model import: a registry of user-imported .gguf files (not in the
// catalog), wired through list/activate/delete/storage so they behave like any
// other installed model — and are protected from orphan cleanup.
// ---------------------------------------------------------------------------

export interface LocalModel { id: string; name: string; primary: string; mmproj?: string; kind: 'text' | 'vision'; params?: number; sizeBytes: number }

function localRegistryFile(): string { return path.join(llm.getModelsDir(), 'local-models.json'); }

export function getLocalModels(): LocalModel[] {
  try {
    const arr = JSON.parse(fs.readFileSync(localRegistryFile(), 'utf-8'));
    return Array.isArray(arr) ? (arr as LocalModel[]) : [];
  } catch { return []; }
}
function saveLocalModels(list: LocalModel[]): void {
  try { fs.writeFileSync(localRegistryFile(), JSON.stringify(list, null, 2)); } catch { /* best effort */ }
}
/** Set of every filename referenced by the local registry (primary + mmproj), so
 *  storage/orphan logic never deletes an imported model. */
function localProtectedNames(): Set<string> {
  const s = new Set<string>();
  for (const m of getLocalModels()) { s.add(m.primary); if (m.mmproj) s.add(m.mmproj); }
  return s;
}

/** A real GGUF starts with the "GGUF" magic and is more than a few bytes. */
function isValidGguf(p: string): boolean {
  try {
    if (fs.statSync(p).size < 1024) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.toString('ascii') === 'GGUF';
  } catch { return false; }
}

/** Import a local .gguf: validate, stream-copy into the models dir (with progress),
 *  and register it so it shows up as an installed, activatable model. */
export async function importLocalModel(srcPath: string, onProgress?: ProgressCb): Promise<{ success: boolean; error?: string; id?: string }> {
  if (!srcPath || !srcPath.toLowerCase().endsWith('.gguf')) return { success: false, error: 'Not a .gguf file' };
  if (!isValidGguf(srcPath)) return { success: false, error: 'File is not a valid GGUF model (corrupt or wrong format)' };

  const dir = llm.getModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  const fileName = path.basename(srcPath);
  const dest = path.join(dir, fileName);
  const id = `local:${fileName}`;
  const total = fs.statSync(srcPath).size;
  const send = (data: Partial<DownloadProgress>): void => { onProgress?.({ modelId: id, ...data }); };

  // Copy unless an identical-size file is already there.
  const already = fs.existsSync(dest) && fs.statSync(dest).size === total;
  if (!already) {
    try {
      await new Promise<void>((resolve, reject) => {
        const rd = fs.createReadStream(srcPath);
        const wr = fs.createWriteStream(dest);
        let copied = 0;
        rd.on('data', (c) => { copied += c.length; send({ status: 'downloading', percent: total ? Math.round((copied / total) * 100) : 0, currentFile: fileName }); });
        rd.on('error', reject); wr.on('error', reject);
        wr.on('finish', () => resolve());
        rd.pipe(wr);
      });
    } catch (e) {
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
      send({ status: 'failed', error: (e as Error).message });
      return { success: false, error: (e as Error).message };
    }
  }

  // Heuristic kind: a paired mmproj makes it vision; otherwise treat as text.
  const base = fileName.replace(/\.gguf$/i, '');
  const list = getLocalModels().filter((m) => m.id !== id);
  list.push({ id, name: base, primary: fileName, kind: 'text', sizeBytes: total });
  saveLocalModels(list);
  send({ status: 'completed', percent: 100 });
  return { success: true, id };
}

// ---------------------------------------------------------------------------
// Storage: disk usage, free space, orphan cleanup
// ---------------------------------------------------------------------------

export interface ModelDiskEntry { id: string; name: string; kind?: string; bytes: number; active: boolean }
export interface StorageInfo {
  dir: string;
  totalBytes: number;   // all model files (incl. orphans + .part) in the models dir
  freeBytes: number;    // free space on the volume
  models: ModelDiskEntry[];
  orphans: { name: string; bytes: number }[];
}

/** Disk usage for models: per installed model, total, free space, and orphan files
 *  (gguf/.part in the models dir that no catalog entry or active selection claims). */
export async function getStorageInfo(): Promise<StorageInfo> {
  const dir = llm.getModelsDir();
  const { CATALOG } = await import('@offgrid/models');
  const known = new Set<string>();
  CATALOG.forEach((m) => m.files?.forEach((f) => known.add(f.name)));
  // Protect imported local models from being flagged/deleted as orphans.
  localProtectedNames().forEach((n) => known.add(n));
  // Protect the active selections' files from being flagged as orphans.
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'active-model.json'), 'utf-8'));
    if (cfg?.primary) known.add(cfg.primary);
    if (cfg?.mmproj) known.add(cfg.mmproj);
  } catch { /* none */ }

  const active = getActiveModel();
  // Per-modality active picks (image/speech/transcription) are stored as the
  // chosen FILENAME, not the catalog id — so an image/voice/STT model is "active"
  // when its primary file matches. Without this, only the chat LLM ever shows
  // active and image models can't be activated from the UI.
  const modals = getAllActiveModals();
  const locals = getLocalModels();
  const installed = await listInstalled();
  const sizeOf = (name: string): number => { try { return fs.statSync(path.join(dir, name)).size; } catch { return 0; } };
  const models: ModelDiskEntry[] = installed.map((id) => {
    const lm = id.startsWith('local:') ? locals.find((m) => m.id === id) : undefined;
    if (lm) {
      const bytes = [lm.primary, lm.mmproj].filter(Boolean).reduce((s, n) => s + sizeOf(n as string), 0);
      return { id, name: lm.name, kind: 'local', bytes, active: id === active };
    }
    const e = CATALOG.find((m) => m.id === id);
    const bytes = (e?.files ?? []).reduce((s, f) => s + sizeOf(f.name), 0);
    const modal = modalityForKind(e?.kind);
    let isActive: boolean;
    if (e?.kind === 'text' || e?.kind === 'vision') {
      isActive = id === active;
    } else if (modal) {
      const chosen = modals[modal];
      const primary = (e?.files?.find((f) => f.role === 'primary') ?? e?.files?.[0])?.name;
      isActive = chosen != null && (chosen === id || chosen === primary);
    } else {
      isActive = false;
    }
    return { id, name: e?.name ?? id, kind: e?.kind, bytes, active: isActive };
  });

  let totalBytes = 0;
  const orphans: { name: string; bytes: number }[] = [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { /* no dir yet */ }
  for (const name of entries) {
    if (!name.endsWith('.gguf') && !name.endsWith('.part')) continue;
    let bytes = 0;
    try { const st = fs.statSync(path.join(dir, name)); if (!st.isFile()) continue; bytes = st.size; } catch { continue; }
    totalBytes += bytes;
    if (!known.has(name.replace(/\.part$/, ''))) orphans.push({ name, bytes });
  }

  let freeBytes = 0;
  try { const s = fs.statfsSync(dir); freeBytes = s.bavail * s.bsize; } catch { /* unknown */ }
  return { dir, totalBytes, freeBytes, models, orphans };
}

/** Delete every orphan file (unreferenced gguf/.part). Recomputes the orphan set so
 *  it can never touch a catalog model or the active selection. */
export async function deleteOrphans(): Promise<{ success: boolean; count: number; freedBytes: number }> {
  const info = await getStorageInfo();
  const dir = llm.getModelsDir();
  let freedBytes = 0, count = 0;
  for (const o of info.orphans) {
    try { fs.rmSync(path.join(dir, o.name), { force: true }); freedBytes += o.bytes; count++; } catch { /* ignore */ }
  }
  return { success: true, count, freedBytes };
}

// ---------------------------------------------------------------------------
// Download registry: surface active/failed/completed downloads + retry, and
// survive an app restart (an interrupted download becomes resumable).
// ---------------------------------------------------------------------------

function downloadsFile(): string { return path.join(llm.getModelsDir(), 'downloads.json'); }
let registryLoaded = false;
function ensureRegistryLoaded(): void {
  if (registryLoaded) return;
  registryLoaded = true;
  try {
    const arr = JSON.parse(fs.readFileSync(downloadsFile(), 'utf-8')) as DownloadProgress[];
    for (const p of arr) {
      // Anything still "downloading" when we last wrote was cut off by a quit/crash.
      if (p.status === 'downloading') { p.status = 'failed'; p.error = 'interrupted — retry to resume'; }
      lastProgress.set(p.modelId, p);
    }
  } catch { /* no registry yet */ }
}
function persistRegistry(): void {
  try {
    const arr = Array.from(lastProgress.values()).filter((p) => p.status !== 'completed');
    if (arr.length) fs.writeFileSync(downloadsFile(), JSON.stringify(arr));
    else fs.rmSync(downloadsFile(), { force: true });
  } catch { /* best effort */ }
}

/** All known downloads (active, failed, interrupted) for a download-manager view. */
export function listDownloads(): DownloadProgress[] {
  ensureRegistryLoaded();
  return Array.from(lastProgress.values());
}

/** Retry (resumes from the partial .part) a failed/interrupted download. */
export async function retryDownload(modelId: string, onProgress?: ProgressCb): Promise<{ success: boolean; error?: string }> {
  return downloadModel(modelId, onProgress);
}

/** Dismiss a download-manager entry: abort it if still running, delete its partial
 *  .part files, and drop it from the registry so it leaves the Downloads list. */
export async function clearDownload(modelId: string): Promise<{ success: boolean; freedBytes: number }> {
  cancelDownload(modelId); // no-op if not currently downloading
  let freedBytes = 0;
  try {
    const dir = llm.getModelsDir();
    const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
    const entry = CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId).catch(() => null));
    for (const f of entry?.files ?? []) {
      const part = path.join(dir, `${f.name}.part`);
      try { freedBytes += fs.statSync(part).size; } catch { /* none */ }
      try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
    }
  } catch { /* best effort */ }
  ensureRegistryLoaded();
  lastProgress.delete(modelId);
  persistRegistry();
  return { success: true, freedBytes };
}

/** Clear every failed/cancelled/interrupted download (entry + .part). */
export async function clearInactiveDownloads(): Promise<{ success: boolean; count: number; freedBytes: number }> {
  ensureRegistryLoaded();
  const ids = Array.from(lastProgress.values())
    .filter((p) => p.status === 'failed' || p.status === 'cancelled')
    .map((p) => p.modelId);
  let freedBytes = 0;
  for (const id of ids) { const r = await clearDownload(id); freedBytes += r.freedBytes; }
  return { success: true, count: ids.length, freedBytes };
}
