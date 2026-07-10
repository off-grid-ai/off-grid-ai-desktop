// Registry of free-form Hugging Face models the user downloaded (search bar), as
// opposed to catalog entries and locally-imported .gguf files. Without this, a
// downloaded HF model (e.g. MiniCPM-V) has its files on disk but nothing records
// it as installed, so it's flagged as "unused" and never offered as a usable
// option (the bug). We key entries by the HF REPO ID so the rest of the app's
// `CATALOG.find(id) ?? resolveHuggingFaceModel(id)` lookups re-resolve them for
// activate/delete with zero extra branching.
//
// Pure/IO-only + parameterized by the models dir, so it's testable against a real
// temp directory with real files (no Electron, no network, no mocks).

import fs from 'fs';
import path from 'path';

export interface DownloadedModel {
  /** The Hugging Face repo id (e.g. "openbmb/MiniCPM-V-2_6-gguf"). */
  id: string;
  name: string;
  kind: string;
  /** On-disk filenames this model comprises (primary + any mmproj/companions). */
  files: string[];
}

function registryPath(dir: string): string {
  return path.join(dir, 'downloaded-models.json');
}

export function readDownloaded(dir: string): DownloadedModel[] {
  try {
    const arr = JSON.parse(fs.readFileSync(registryPath(dir), 'utf-8'));
    return Array.isArray(arr) ? (arr as DownloadedModel[]) : [];
  } catch {
    return [];
  }
}

function writeDownloaded(dir: string, list: DownloadedModel[]): void {
  try {
    fs.writeFileSync(registryPath(dir), JSON.stringify(list, null, 2));
  } catch {
    /* best effort */
  }
}

/** Record a downloaded model (replacing any existing entry with the same id). */
export function recordDownloaded(dir: string, model: DownloadedModel): void {
  const next = readDownloaded(dir).filter((m) => m.id !== model.id);
  next.push(model);
  writeDownloaded(dir, next);
}

/** Drop a downloaded model from the registry (after its files are deleted). */
export function removeDownloaded(dir: string, id: string): void {
  writeDownloaded(dir, readDownloaded(dir).filter((m) => m.id !== id));
}

/** A downloaded model looked up by id (or undefined). */
export function findDownloaded(dir: string, id: string): DownloadedModel | undefined {
  return readDownloaded(dir).find((m) => m.id === id);
}

/** Ids of downloaded models whose every file is present on disk (size > 0). A
 *  partially-deleted model is NOT installed. */
export function installedDownloadedIds(dir: string): string[] {
  return readDownloaded(dir)
    .filter((m) => m.files.length > 0 && m.files.every((f) => {
      try { return fs.statSync(path.join(dir, f)).size > 0; } catch { return false; }
    }))
    .map((m) => m.id);
}

/** Every filename referenced by the downloaded registry, so storage/orphan logic
 *  never flags a downloaded model as an "unused file". */
export function downloadedProtectedNames(dir: string): Set<string> {
  const s = new Set<string>();
  for (const m of readDownloaded(dir)) for (const f of m.files) s.add(f);
  return s;
}
