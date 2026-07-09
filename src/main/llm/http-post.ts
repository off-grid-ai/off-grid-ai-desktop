// The single source of truth for how we talk HTTP to the local model server, isolated from
// the electron-bound LLMService so it can be exercised by a real integration test.
//
// Why this exists: the agentic tool loop makes BACK-TO-BACK requests to llama-server. The
// server closes its socket after each response; Node's global keep-alive agent pools that
// socket, so the next request grabs a half-closed socket and the write fails with ECONNRESET.
// Single-shot chat never reused a socket, so only the multi-round tool loop broke. The fix is
// a FRESH connection per request (`agent: false` + `Connection: close`). This module defines
// that contract ONCE; every request site in llm.ts builds its options from here (DRY), and the
// integration test drives postCompletionOnce against a real socket-closing server (behaviour).

import * as http from 'http';

/** The request options that guarantee a fresh, non-pooled connection to the model server.
 *  This is the contract that unbroke the tool loop — defined once, consumed everywhere. */
export function modelRequestOptions(port: number, contentLength: number): http.RequestOptions {
  return {
    hostname: '127.0.0.1',
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    // Fresh connection per request — do NOT reuse a pooled keep-alive socket (the server
    // closes its socket after each response; a reused one is half-closed -> ECONNRESET).
    agent: false,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': contentLength,
      'Connection': 'close',
    },
  };
}

/** One non-streaming POST to /v1/chat/completions, resolving the raw body text. Rejects on a
 *  non-200, a transport error, or a timeout. Electron-free so it can be integration-tested. */
export function postCompletionOnce(port: number, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      reject(new Error('LLM request timed out - try a shorter prompt'));
    }, timeoutMs);

    const req = http.request(modelRequestOptions(port, Buffer.byteLength(body)), (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        if (timedOut) { return; }
        if (res.statusCode !== 200) { reject(new Error(`LLM Server Error: ${res.statusCode} ${data}`)); return; }
        resolve(data);
      });
    });
    req.on('error', (e) => { clearTimeout(timer); if (!timedOut) { reject(e); } });
    req.write(body);
    req.end();
  });
}
