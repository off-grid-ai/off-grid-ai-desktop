import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Architectural guard for the agentic-tool ECONNRESET fix (behaviour is proven by
// llm/__tests__/http-post.integration.test.ts against a real socket-closing server).
//
// The fresh-connection contract (agent: false + Connection: close) now lives in ONE place —
// modelRequestOptions in llm/http-post.ts. This test asserts llm.ts never BYPASSES that single
// source of truth with a raw http.request that builds its own options — which is how the bug
// would silently creep back (a new request site that forgot the no-pool contract). Guarded at
// the source because llm.ts pulls in electron and can't be imported in a unit test.
const src = readFileSync(join(__dirname, '..', 'llm.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('llm.ts routes every model request through the shared no-pool contract', () => {
  it('has no raw http.request({...}) that bypasses modelRequestOptions', () => {
    // Any http.request( in llm.ts must pass modelRequestOptions(...) as its options object,
    // never an inline literal (which could omit agent:false and re-open the ECONNRESET hole).
    const inlineOptionsRequest = /http\.request\(\s*\{/g;
    expect(src.match(inlineOptionsRequest)).toBeNull();
  });

  it('every http.request site uses modelRequestOptions()', () => {
    const requestSites = src.match(/http\.request\(/g)?.length ?? 0;
    const viaContract = src.match(/http\.request\(\s*modelRequestOptions\(/g)?.length ?? 0;
    // Non-streaming path delegates to postCompletionOnce (no direct http.request in llm.ts),
    // so the only http.request sites left are the streaming ones — all via modelRequestOptions.
    expect(viaContract).toBe(requestSites);
  });
});
