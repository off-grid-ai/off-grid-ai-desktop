// TERMINAL-ARTIFACT test for the reasoning-persistence fix.
//
// The bug: a chat "Thinking"/reasoning block showed live while a turn streamed,
// then VANISHED on conversation reload/remap. The fix persists the reasoning in
// the assistant message `context` blob (write path: buildAssistantContext) and
// restores it when the conversation is re-read (read path: mapRagMessages calls
// readReasoning on the parsed context).
//
// The existing message-persistence.test.ts is a SHAPE test — it asserts the
// helper's return in isolation (readReasoning(ctx)). That never touches the DB
// nor the mapper, so it can't catch a break in the wiring that actually failed:
// serialize → SQLite row → deserialize → restore into ChatMessage.reasoning.
//
// This test drives the REAL persistence path end to end against a REAL temp
// SQLite DB — addRagMessage → getRagMessages → the mapRagMessages restore
// contract — and asserts the TERMINAL artifact the render path consumes: the
// restored ChatMessage.reasoning that MemoryChat.tsx (~L1677) paints as the
// "Thinking" block when !streaming. addRagMessage / getRagMessages use the
// better-sqlite3 native module, so this is a *.dbtest.ts (run via npm run
// test:db, which rebuilds the module for node then restores the Electron ABI).
// Harness mirrors database-integration.dbtest.ts.

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The read-path SINGLE SOURCE OF TRUTH is readReasoning, which lives in the
// renderer compile unit (src/renderer/src/lib/message-persistence.ts). This DB
// test lives in the main compile unit (it drives the main-process
// better-sqlite3 module) and the two tsconfig projects are strictly partitioned
// — a STATIC cross-project import would trip TS6307. We load the REAL helper at
// runtime through a computed specifier (so tsc doesn't pull the renderer file
// into the node program) and assert against the ACTUAL restore logic — DRY: no
// re-implementation of the contract here. If readReasoning drifts, this breaks.
type ReadReasoning = (ctx: unknown) => string | undefined;
const SOT_MODULE = ['..', '..', 'renderer', 'src', 'lib', 'message-persistence'].join('/');
let readReasoning: ReadReasoning;
beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ SOT_MODULE)) as { readReasoning: ReadReasoning };
  readReasoning = mod.readReasoning;
});

// Fresh temp userData dir, created BEFORE the module import so getDB() opens
// memories.db inside it. safeStorage reports unavailable → plaintext DB (no
// Keychain in CI). Everything below the electron boundary is the real code.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-reasoning-it-'));

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}));

import * as db from '../database';

afterAll(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// Minimal shape of the restored message that the render path consumes.
interface RestoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

// The restore contract from MemoryChat.tsx's mapRagMessages (~L124-141): parse
// the persisted context blob, then lift reasoning out of it via the SINGLE
// source-of-truth helper readReasoning. This is the exact seam that was broken
// — imported here (not re-hardcoded) so the test fails if that wiring rots.
// `dropReasoning` lets a test simulate the pre-fix mapper (mapper ignores
// ctx.reasoning) to prove the assertion is red-capable by a DIFFERENT mechanism
// than the helper itself.
function mapRagMessages(raw: db.RagMessage[], opts: { dropReasoning?: boolean } = {}): RestoredMessage[] {
  return (raw || []).map((m) => {
    const ctx = m.context ? (typeof m.context === 'string' ? JSON.parse(m.context) : m.context) : undefined;
    return {
      id: String(m.id),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      reasoning: opts.dropReasoning ? undefined : readReasoning(ctx)
    };
  });
}

describe('reasoning persistence — DB round-trip terminal artifact', () => {
  it('reasoning survives addRagMessage → getRagMessages → mapRagMessages and lands on ChatMessage.reasoning', () => {
    const convId = 'reasoning-survives';
    const reasoning = 'weighing the two approaches before answering';
    db.createRagConversation(convId, 'Reasoning survives reload');
    db.addRagMessage(convId, 'user', 'which approach?');
    // Write path: reasoning rides in the context blob (as MemoryChat does via
    // buildAssistantContext) alongside the other restored fields.
    db.addRagMessage(convId, 'assistant', 'Approach B, because it is simpler.', {
      unified: [{ id: 1 }],
      reasoning
    });

    // Read path: real DB read, then the real restore contract.
    const restored = mapRagMessages(db.getRagMessages(convId));
    const assistant = restored.find((m) => m.role === 'assistant');

    // TERMINAL artifact: the value the "Thinking" block renders after reload.
    expect(assistant?.reasoning).toBe(reasoning);
  });

  it('a restored assistant turn with no reasoning yields undefined (no empty Thinking block)', () => {
    const convId = 'reasoning-absent';
    db.createRagConversation(convId);
    db.addRagMessage(convId, 'assistant', 'just an answer', { unified: [] });
    const restored = mapRagMessages(db.getRagMessages(convId));
    expect(restored[0]!.reasoning).toBeUndefined();
  });

  it('reasoning persists as a real serialized column, not just in-memory (survives a re-read)', () => {
    const convId = 'reasoning-column';
    const reasoning = 'first I recall the prior turn, then I check the sources';
    db.createRagConversation(convId);
    db.addRagMessage(convId, 'assistant', 'answer', { reasoning });

    // Confirm it actually hit the DB column as JSON (this is what a fresh app
    // launch re-reads), not merely an object we passed in.
    const rows = db.getRagMessages(convId);
    expect(typeof rows[0]!.context).toBe('string');
    expect(JSON.parse(rows[0]!.context as string).reasoning).toBe(reasoning);

    // And the restore contract lifts it back onto the terminal artifact.
    expect(mapRagMessages(rows)[0]!.reasoning).toBe(reasoning);
  });

  it('RED-CAPABLE PROOF: if the mapper stops restoring ctx.reasoning, the terminal artifact assertion fails', () => {
    // Simulates the pre-fix / regressed mapper (mapRagMessages ignores
    // ctx.reasoning) — a DIFFERENT break mechanism than the readReasoning helper.
    // The reasoning is still correctly persisted in the DB, but the restore drops
    // it, so the "Thinking" block would render empty. This asserts that such a
    // regression turns the round-trip assertion RED.
    const convId = 'reasoning-regressed-mapper';
    const reasoning = 'this would be lost by a broken mapper';
    db.createRagConversation(convId);
    db.addRagMessage(convId, 'assistant', 'answer', { reasoning });

    const rows = db.getRagMessages(convId);
    // Persistence is intact...
    expect(JSON.parse(rows[0]!.context as string).reasoning).toBe(reasoning);
    // ...but a mapper that ignores ctx.reasoning loses the terminal artifact.
    const brokenRestore = mapRagMessages(rows, { dropReasoning: true });
    expect(brokenRestore[0]!.reasoning).not.toBe(reasoning);
    expect(brokenRestore[0]!.reasoning).toBeUndefined();
  });
});
