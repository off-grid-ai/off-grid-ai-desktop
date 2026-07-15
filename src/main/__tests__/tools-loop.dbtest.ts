// Integration test for the agentic tool loop — the REAL toolChat + REAL LLMService,
// over a real in-process fake llama-server socket and a real temp SQLite DB. The ONLY
// things faked are true external boundaries: the native engine (its tokens replayed as
// real SSE over http, see harness/fake-llama-server) and Electron's userData dir. No
// mock of our own code, no canned llm, no toHaveBeenCalled — the real streaming, real
// tool-call assembly, real dispatch/runTool, and the real calculator all execute, and
// we assert the terminal artifacts (the produced result, the streamed answer, and what
// the model was actually sent on the follow-up round).
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeLlamaServer, type FakeLlamaServer } from './harness/fake-llama-server';

// Fresh temp userData so the REAL better-sqlite3 DB + settings live somewhere isolated.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-tools-it-'));
vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

// Imported AFTER the electron boundary is stubbed so their top-level app.getPath resolves.
import { toolChat } from '../tools';
import { llm } from '../llm';

let fake: FakeLlamaServer;

beforeAll(async () => {
  fake = await startFakeLlamaServer();
  // Point the REAL LLMService at the fake engine socket and mark it ready — init() then
  // no-ops (it early-returns when initialized), so no native binary is spawned. Every
  // other line of the service runs for real against the socket.
  const svc = llm as unknown as { port: number; initialized: boolean; paused: boolean };
  svc.port = fake.port;
  svc.initialized = true;
  svc.paused = false;
});

afterAll(async () => {
  await fake.close();
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('agentic tool loop — real toolChat + real LLMService over a fake llama socket', () => {
  it('runs the calculator the model asks for, feeds the real result back, and answers', async () => {
    // Round 1: the model emits a tool_call for the built-in calculator.
    // Round 2: it answers using the result the loop fed back.
    fake.enqueue(
      { toolCalls: [{ name: 'calculator', args: { expression: '(3+4)*2' } }] },
      { content: 'The answer is 14.' },
    );

    const r = await toolChat('what is (3+4)*2', []);

    // Terminal artifact 1: the REAL calculator evaluated the expression (14), not a canned value.
    expect(r.toolCalls.map((c) => ({ name: c.name, result: c.result }))).toContainEqual({ name: 'calculator', result: '14' });
    // Terminal artifact 2: the final streamed answer.
    expect(r.answer).toContain('14');
    // The loop actually fed the tool result back: the follow-up request the model received
    // carries a message containing the calculator's output.
    const round2 = fake.requests[1] as { messages?: Array<{ role: string; content: unknown }> } | undefined;
    expect(round2, 'model should have received a second (post-tool) round').toBeTruthy();
    expect(JSON.stringify(round2?.messages ?? [])).toContain('14');
  });

  it('surfaces an actionable server error (context overflow) instead of a bare status', async () => {
    // The engine 400s with its real overflow body; the real describeServerError maps it.
    fake.enqueue({ errorStatus: 400, errorBody: JSON.stringify({ error: { message: 'the request exceeds the available context size' } }) });
    await expect(toolChat('anything', [])).rejects.toThrow(/context window|connectors/i);
  });
});
