// D25 — getRagConversations has a tri-state scope argument that was untested (a
// latent sharp edge, not a live bug): `undefined` = ALL conversations, `null` =
// only UNSCOPED (no project), a project id = only that project's. A caller that
// passed `null` expecting "all" would get only the orphans. This locks the
// contract so that distinction can't silently drift.

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-ragscope-'));

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

import * as db from '../database';

afterAll(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

describe('getRagConversations scope tri-state (D25)', () => {
  it('undefined = all, null = unscoped only, id = that project only', () => {
    db.createRagConversation('c-none', 'Unscoped chat', null);
    db.createRagConversation('c-p1', 'Project 1 chat', 'p1');
    db.createRagConversation('c-p2', 'Project 2 chat', 'p2');

    const ids = (list: { id: string }[]): string[] => list.map((c) => c.id).sort();

    // undefined → every conversation regardless of project.
    expect(ids(db.getRagConversations())).toEqual(['c-none', 'c-p1', 'c-p2']);
    // null → ONLY the unscoped one (NOT "all" — the sharp edge).
    expect(ids(db.getRagConversations(null))).toEqual(['c-none']);
    // a project id → ONLY that project's.
    expect(ids(db.getRagConversations('p1'))).toEqual(['c-p1']);
  });
});
