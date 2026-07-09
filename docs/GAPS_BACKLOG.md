# Gaps backlog

Honest log of gaps, regressions, and "not fully done" items. Each entry: what, evidence,
how to reproduce, and the fix direction. Close with evidence; never hide.

---

## RESOLVED

### Agentic `generate_image` tool errored (stale keep-alive socket in the tool loop) — FIXED

**Status:** RESOLVED. Root cause was NOT eviction (the original hypothesis below was wrong)
— it was a reused HTTP keep-alive socket. Fixed + regression-guarded.

**Actual root cause (verified with in-process DIAG instrumentation):** the tool loop makes
BACK-TO-BACK requests to llama-server. `llm.pause()`/`stop()` were never called (DIAG confirmed
the engine stayed alive: `serverAlive=true, initialized=true` at the error). Round 0 (the
`generate_image` call) succeeded; round 1's `streamChat` died with `read ECONNRESET`. Node's
global HTTP agent pooled the round-0 socket; llama-server closes its socket after each response,
so the pooled socket was half-closed and round 1's write reset. Single-shot chat never reused a
socket, which is exactly why only the multi-round tool path broke.

**Fix:** `src/main/llm.ts` — every `http.request` to the model now sets `agent: false` +
`Connection: close` (a fresh connection per request, no keep-alive pool). Applied to all three
request sites (both streaming methods + the non-streaming one).

**Verified:** in-process repro against the real `window.api.toolChat` now returns
`{ ok: true, toolCalls: ["generate_image"], imageRequest: { prompt: "a solid red circle on a
white background" } }` with no ECONNRESET — warm and cold.

**Regression guard:** `src/main/__tests__/llm-http-no-keepalive.test.ts` reads llm.ts and asserts
every `http.request` site opts out of the pool (`agent: false` + `Connection: close`). Fails on
`main` (0 of 3), passes after. (llm.ts can't be imported in a unit test — it pulls in electron —
so the contract is guarded at the source, per the extract-prompt.test.ts pattern.)

**Note on the earlier hypothesis (kept for honesty):** the first diagnosis blamed the modality
queue evicting `llm` mid-loop (`imagegen.ts:389` `evicts:['llm']`). DIAG disproved it — pause was
never called. The eviction machinery is fine; the bug was purely the socket pool.

---

## OPEN

### (historical hypothesis — see RESOLVED above) Agentic `generate_image` tool errors

**Status:** superseded by the RESOLVED entry above (root cause was the keep-alive socket, not
eviction). Kept below only as the investigation trail.

**What:** The "image generation as an agentic tool" feature (the LLM calling `generate_image`
in `toolChat`, meant to be the backstop when the intent classifier misses an image request)
does NOT work end to end. In chat with **Tools ON** and **no project**, a request that reaches
the tool loop returns *"Sorry, something went wrong while generating a response."*
(`MemoryChat.tsx:927`).

**Evidence (all verified):**
- Engine + model are fine: direct probe of `:8439` (streaming, `generate_image` schema) returns
  `finish_reason: "tool_calls"`, `name: "generate_image"`, `arguments: {"prompt":"a solid red
  circle on a plain white background"}`. The multi-round re-feed (assistant `tool_calls` +
  `role:tool` result) also returns HTTP 200.
- In-process repro against the real `window.api.toolChat` (Playwright-launched app, main stderr
  captured): `tools:chat` throws `read ECONNRESET` on every call, warm or cold.
- llama-server logs a CLEAN exit mid-loop: `srv operator(): cleaning up before exit... exited
  with code 0` immediately after round 1 emits the tool call. Not a crash — a deliberate kill.

**Root cause:** image generation runs `modalityQueue.run({ tier: 2, label: 'image',
evicts: ['llm'] })` (`imagegen.ts:389`) — it evicts (kills) llama-server to free unified-memory
RAM. An image-modality job evicts llama while the `toolChat` loop is between rounds, so the
loop's next `streamChat` (`llm.ts:723`, hitting `:8439`) dies with ECONNRESET. The tool loop has
no guard against its own engine being evicted underneath it.

**Reproduce:**
1. `OFFGRID_USER_DATA=<seeded profile> OFFGRID_PRO=1` app.
2. Chat → memory scope "No memory" → composer "+" → Tools On.
3. Send a prompt that dodges `looksLikeImageRequest` (so it hits the tool, not the classifier),
   e.g. "Use your built-in image tool to output a solid red circle on a plain white background."
4. Reply is the generic error; llama-server shows a clean mid-loop exit.

**Fix direction:** guard the engine lifecycle so the LLM is not evicted while a tool loop that may
still need it is in flight — e.g. hold an "llm in use" lease for the duration of `toolChat`, or
make the deferred-image tool defer the ACTUAL eviction until the loop has returned (it already
defers generation to the renderer; the eviction race is the remaining hole). Add a regression
test that runs a `toolChat` turn which calls `generate_image` and asserts it returns an
`imageRequest` without the engine being torn down.

**Not the cause (ruled out):** the model refusing to call the tool (it calls it correctly); a
cold-load race (fails warm too); the `<|tool_response>` tokenizer warnings (non-fatal).

**Related:** the renderer intent classifier (`image-intent.ts` `looksLikeImageRequest`) is the
ONLY working in-chat image path today; a leading "draw/sketch/paint/illustrate/render" routes
straight to `generateImage()` (`MemoryChat.tsx:740`), bypassing the tool. That is what produced
the image in the first provit chat run (PR #40 comment) — not the tool.
