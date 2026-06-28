// One place to see and delete on-device data. Local-first: this is the user's
// data on their machine, so deletion is real and immediate (SQLite rows + the
// data directories). Models are intentionally NOT included here — they're managed
// (with sizes) in the Storage panel, and re-downloading is expensive.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDB } from './database';
import { deleteByKinds, resetVectors } from './vectors';

export interface DataCategory {
  id: 'chats' | 'memories' | 'captures' | 'meetings' | 'images';
  label: string;
  detail: string;
  count?: number;
  bytes?: number;
}

const ud = (...p: string[]): string => path.join(app.getPath('userData'), ...p);

function dirSize(p: string): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  try {
    for (const name of fs.readdirSync(p)) {
      const fp = path.join(p, name);
      try {
        const st = fs.statSync(fp);
        if (st.isDirectory()) { const sub = dirSize(fp); bytes += sub.bytes; files += sub.files; }
        else { bytes += st.size; files += 1; }
      } catch { /* skip */ }
    }
  } catch { /* missing dir */ }
  return { bytes, files };
}

function clearDirs(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      for (const name of fs.readdirSync(d)) fs.rmSync(path.join(d, name), { recursive: true, force: true });
    } catch { /* missing */ }
  }
}

/** Delete only entries older than `days` (by mtime) — for time-based retention on
 *  captures/meetings. Handles both flat files and day-subdirectories. */
function clearDirsOlderThan(days: number, ...dirs: string[]): void {
  const cutoff = Date.now() - days * 86400000;
  for (const d of dirs) {
    try {
      for (const name of fs.readdirSync(d)) {
        const fp = path.join(d, name);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { recursive: true, force: true }); } catch { /* skip */ }
      }
    } catch { /* missing */ }
  }
}

function tableCount(table: string): number {
  try { return (getDB().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c; }
  catch { return 0; }
}

function clearTables(...tables: string[]): void {
  const db = getDB();
  for (const t of tables) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist */ } }
}

// The `meetings` table is written by Pro (data-privacy is core), so we can't own
// its schema — but it lives in the same DB. After deleting meeting media we drop
// any row whose audio file is now gone, so the Meetings list never shows ghost
// rows that 404 on play. Unit-agnostic (works for full clear + age-based prune).
// Guarded: in the free build there's no meetings table, so this no-ops.
function pruneDanglingMeetings(): void {
  try {
    const db = getDB();
    const rows = db.prepare('SELECT id, audio_path FROM meetings').all() as { id: number; audio_path: string | null }[];
    const del = db.prepare('DELETE FROM meetings WHERE id = ?');
    for (const r of rows) {
      if (!r.audio_path || !fs.existsSync(r.audio_path)) del.run(r.id);
    }
  } catch { /* no meetings table (free build) */ }
}

// Which SQL tables + directories belong to each category.
const CHAT_TABLES = ['conversations', 'messages', 'rag_conversations', 'rag_messages', 'chat_summaries'];
const MEMORY_TABLES = ['memories', 'master_memory', 'entities', 'entity_edges', 'entity_facts', 'entity_sessions'];

/** Summary of what's stored, per category, for the Delete-my-data screen. */
export function getDataSummary(): DataCategory[] {
  const captures = dirSize(ud('captures'));
  const meetings = dirSize(ud('meetings'));
  const images = (() => {
    const a = dirSize(ud('generated-images')), b = dirSize(ud('artifacts-library')), c = dirSize(ud('style-thumbs'));
    return { bytes: a.bytes + b.bytes + c.bytes, files: a.files + b.files + c.files };
  })();
  return [
    { id: 'chats', label: 'Chats', detail: 'Conversations and messages', count: tableCount('rag_conversations') + tableCount('conversations') },
    { id: 'memories', label: 'Memory & entities', detail: 'Observations, entities, and what Off Grid has learned', count: tableCount('memories') + tableCount('entities') },
    { id: 'captures', label: 'Screen captures', detail: 'Captured frames and OCR', count: captures.files, bytes: captures.bytes },
    { id: 'meetings', label: 'Meetings', detail: 'Recordings and transcripts', count: meetings.files, bytes: meetings.bytes },
    { id: 'images', label: 'Generated images & artifacts', detail: 'Images, artifacts, and thumbnails', count: images.files, bytes: images.bytes },
  ];
}

/** Delete one category of data (SQL rows + its directories). For captures/meetings,
 *  pass olderThanDays to delete only entries older than N days (retention cleanup). */
export async function clearCategory(id: DataCategory['id'], olderThanDays?: number): Promise<{ success: boolean }> {
  switch (id) {
    case 'chats':
      clearTables(...CHAT_TABLES);
      clearDirs(ud('uploads'));
      break;
    case 'memories':
      clearTables(...MEMORY_TABLES);
      clearDirs(ud('entity-photos'));
      // Delete ONLY the memory-side vectors (not the shared lancedb dir — that
      // would wipe capture/meeting/chat vectors and dangle the live handle).
      await deleteByKinds(['memory', 'entity', 'fact']);
      break;
    case 'captures':
      if (olderThanDays && olderThanDays > 0) {
        clearDirsOlderThan(olderThanDays, ud('captures'));
      } else {
        clearDirs(ud('captures'));
        await deleteByKinds(['screen']); // full clear → drop capture vectors too
      }
      break;
    case 'meetings':
      if (olderThanDays && olderThanDays > 0) {
        clearDirsOlderThan(olderThanDays, ud('meetings'));
      } else {
        clearDirs(ud('meetings'));
        await deleteByKinds(['meeting']); // full clear → drop meeting vectors too
      }
      pruneDanglingMeetings(); // drop rows whose media we just deleted (no ghosts)
      break;
    case 'images':
      clearDirs(ud('generated-images'), ud('artifacts-library'), ud('style-thumbs'));
      break;
  }
  return { success: true };
}

/** Delete ALL personal data (every category + the user profile). Leaves installed
 *  models, license, and app preferences intact. */
export function deleteAllData(): { success: boolean } {
  clearTables(...CHAT_TABLES, ...MEMORY_TABLES, 'user_profile');
  clearDirs(
    ud('captures'), ud('meetings'), ud('uploads'),
    ud('generated-images'), ud('artifacts-library'), ud('style-thumbs'),
    ud('lancedb'), ud('entity-photos'),
  );
  resetVectors(); // the lancedb dir is gone — drop cached handles so it reopens clean
  pruneDanglingMeetings(); // media is gone now → drop all meeting rows (no ghosts)
  return { success: true };
}
