# Gaps backlog

Honest log of gaps, regressions, and "not fully done" items. Each entry: what, evidence,
how to reproduce, and the fix direction. Close with evidence; never hide.

---

## OPEN

### Agentic `generate_image` tool errors (llama-server evicted mid-tool-loop)

**Status:** open — real bug, reproduced deterministically.

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
