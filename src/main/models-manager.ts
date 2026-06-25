// Central model management — the single source of truth for catalog, install
// listing, download (pull), delete, and activation. Used by BOTH the desktop IPC
// handlers (UI) AND the headless gateway HTTP admin endpoints, so the full
// repertoire (pull / delete / activate / list) works with or without a UI.
import fs from 'fs';
import path from 'path';
import { llm } from './llm';
import { getAllActiveModals, setActiveModal as setModal, type Modality } from './active-models';

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
  return { kinds: MODEL_KINDS, models: CATALOG };
}

/** Catalog ids whose files are fully present on disk. */
export async function listInstalled(): Promise<string[]> {
  const { CATALOG } = await import('@offgrid/models');
  const { isMfluxModelCached } = await import('./mflux');
  const dir = llm.getModelsDir();
  return CATALOG.filter((m) => {
    if (m.runtime === 'mflux') return isMfluxModelCached(m.id);
    return m.files.length > 0 && m.files.every((f) => {
      try { return fs.statSync(path.join(dir, f.name)).size > 0; } catch { return false; }
    });
  }).map((m) => m.id);
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
  const send = (data: Partial<DownloadProgress>): void => {
    const p: DownloadProgress = { modelId, ...data };
    lastProgress.set(modelId, p);
    onProgress?.(p);
  };

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
      const res = await fetch(file.url, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${file.name}`);
      const total = Number(res.headers.get('content-length') ?? 0);
      const partPath = `${dest}.part`;
      const out = fs.createWriteStream(partPath);
      let written = 0;
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
  const { CATALOG, resolveHuggingFaceModel } = await import('@offgrid/models');
  const entry = CATALOG.find((m) => m.id === modelId) ?? (await resolveHuggingFaceModel(modelId));
  if (!entry) return { success: false, error: 'unknown model' };
  const dir = llm.getModelsDir();
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

export function setActiveModalChoice(kind: string, modelId: string | null): { success: boolean; error?: string } {
  if (kind === 'image' || kind === 'speech' || kind === 'transcription') {
    setModal(kind, modelId);
    return { success: true };
  }
  return { success: false, error: 'use setActiveModel for the chat LLM (text/vision)' };
}

export function getActiveModalities(): { text: string | null } & Record<Modality, string | null> {
  return { text: getActiveModel(), ...getAllActiveModals() };
}
