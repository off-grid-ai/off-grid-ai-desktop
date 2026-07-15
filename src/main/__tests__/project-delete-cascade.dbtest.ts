// D20 — deleting a project must remove its chats + artifacts (real temp SQLite).
//
// Product-correct outcome (the confirm dialog's own promise): "Delete this
// project, its knowledge base and chats." So after deleteProject, the project's
// chats (rag_conversations scoped to it, + their rag_messages) and its generated
// artifacts are gone — not orphaned to a phantom project id.
//
// On HEAD this is RED: deleteProject sweeps rag_documents/rag_chunks and the DEAD
// project_threads/project_messages backend, but never rag_conversations (the table
// the UI actually writes project chats to — no FK, no cascade), and never the
// artifacts. Both survive, badged to a deleted project.
//
// Integration over the REAL data layer: seed via the REAL insert paths
// (createProject, createRagConversation, addRagMessage, saveArtifact), run the
// REAL deleteProject (the projects:delete handler is a one-liner over it), assert
// the terminal artifact — surviving rows + artifact files. Only Electron's
// userData dir + safeStorage are faked (the true boundaries).

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-projdel-'));

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import * as dbmod from '../database';
import { createProject, deleteProject } from '../rag/store';
import { saveArtifact, listArtifacts } from '../artifacts';

const count = (sql: string, ...args: unknown[]): number =>
  (dbmod.getDB().prepare(sql).get(...args) as { c: number }).c;

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('deleteProject — removes the project\'s chats + artifacts (D20)', () => {
  it('orphans nothing: rag_conversations, rag_messages, and artifacts all gone', () => {
    createProject({ id: 'p1', name: 'Roadmap' });
    dbmod.createRagConversation('c1', 'Planning chat', 'p1'); // a PROJECT-scoped chat
    dbmod.addRagMessage('c1', 'user', 'what is next?');
    dbmod.addRagMessage('c1', 'assistant', 'ship the fix');
    saveArtifact({ kind: 'text', code: 'the plan', title: 'Plan', conversationId: 'c1', projectId: 'p1' });

    // Precondition: the chat, its messages, and the artifact are really there.
    expect(count('SELECT COUNT(*) AS c FROM rag_conversations WHERE project_id = ?', 'p1')).toBe(1);
    expect(count('SELECT COUNT(*) AS c FROM rag_messages WHERE conversation_id = ?', 'c1')).toBe(2);
    expect(listArtifacts({ projectId: 'p1' }).length).toBe(1);

    deleteProject('p1');

    // Terminal artifact: nothing scoped to the deleted project survives.
    expect(count('SELECT COUNT(*) AS c FROM rag_conversations WHERE project_id = ?', 'p1')).toBe(0);
    expect(count('SELECT COUNT(*) AS c FROM rag_messages WHERE conversation_id = ?', 'c1')).toBe(0);
    expect(listArtifacts({ projectId: 'p1' }).length).toBe(0);
  });
});
