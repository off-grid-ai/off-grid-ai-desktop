import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the agentic-tool ECONNRESET bug.
//
// The tool loop (tools.ts `toolChat`) makes BACK-TO-BACK requests to llama-server. The
// server closes its socket after each response, so a reused keep-alive socket from the
// global HTTP agent is already half-closed on the next round and the write fails with
// `read ECONNRESET` — the whole turn then surfaces "Sorry, something went wrong". Single-
// shot chat never reused a socket, which is why only the multi-round tool path broke.
//
// The fix: every request llm.ts makes to the model opts OUT of the keep-alive pool
// (`agent: false` + `Connection: close`), so each round gets a fresh connection. This
// test reads the source and asserts that contract holds for EVERY request site, so the
// pool can't creep back in. (llm.ts can't be imported here — it pulls in electron — so
// we guard the contract at the source, the same way extract-prompt.test.ts does.)
// Strip comments so the guard measures real code, not the prose that explains it.
const src = readFileSync(join(__dirname, '..', 'llm.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('llm.ts model HTTP requests never reuse a pooled socket', () => {
  it('every http.request to the model completions endpoint sets agent: false', () => {
    // Each request block targets '/v1/chat/completions'; count them and require an
    // `agent: false` for each so no request site can rejoin the keep-alive pool.
    const requestSites = src.match(/http\.request\(/g)?.length ?? 0;
    const agentFalse = src.match(/agent:\s*false/g)?.length ?? 0;
    expect(requestSites).toBeGreaterThan(0);
    expect(agentFalse).toBe(requestSites);
  });

  it("sends Connection: close so the server does not hold the socket open", () => {
    const closeHeaders = src.match(/['"]Connection['"]:\s*['"]close['"]/g)?.length ?? 0;
    const requestSites = src.match(/http\.request\(/g)?.length ?? 0;
    expect(closeHeaders).toBe(requestSites);
  });
});
