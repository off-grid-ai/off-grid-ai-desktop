# Gaps backlog

Honest log of gaps, regressions, and "not fully done" items. Each entry: what, evidence,
how to reproduce, and the fix direction. Close with evidence; never hide.

---

## OPEN — data-layer / presentation-layer drift (sweep 2026-07-09)

Class: the UI keeps its own copy of authoritative data instead of binding to the owning source
(hygiene §A "the data layer powers the presentation"). Found via a 3-agent read-only sweep of
core renderer, core persistence seams, and pro. Verdicts are evidence-based; where an agent
self-corrected fabricated findings, only the verified ones are carried here.

### TIER 1 — real drift bugs (fix these)

**T1a. Image composer: `imgModel` shadows the active image model.** `MemoryChat.tsx:252/465/2046`.
Local `useState` seeded once from `imageGenStatus().active` (guarded `prev || active`, so it never
re-syncs); the dropdown `onChange` writes only local state, never `setActiveModalModel('image',…)`.
The Active-models panel (`ModelPicker.tsx:48`) writes through, so the two hold independent copies
and silently disagree about which model runs (generation uses the composer copy, `:758`).
Fix: bind the dropdown to the one owning source — `onChange` → `setActiveModalModel`, read the
active value reactively (drop the latch).

**T1b. Image composer: `imgSteps`/`imgSize` re-seed stomp.** `MemoryChat.tsx:246,496-501`. A
`[imgModel]` effect resets steps/size to `standardModelDefaults` on every model change, overwriting
what the user typed → "set 10, generated 28". Also never persisted. Fix: only seed when the user
hasn't overridden (dirty flag / seed-once-per-model), and persist per-model through the data layer.

**T1c. Image composer: `imgSeed`/`imgNegative`/`imgStrength`/`imgInit`/`activeStyle` never
persisted.** `MemoryChat.tsx:247-253`. Read at generate time but reset to defaults on every
remount/restart (unlike the chat prefs at `:307-311`, which persist correctly and are the right
pattern to copy). Fix: persist via the data layer.

**T1d. Image settings have no home in Settings + no persisted owner at all.** The Settings > Model
tab has every LLM param but NO image section; image params live only in the transient composer,
which is *why* T1a–T1c exist. Fix (subsumes T1a–T1c): give image-gen params a single persisted
owner (a settings store / active-models extension) and bind BOTH the composer and a new
Settings > Image section to it.

**T1e. KV cache / FlashAttn / ctxSize: two-writer clobber via the performance-mode preset.**
`llm.ts:185-190` + `settings-math.ts:15-19`. These persist + reload correctly, BUT when a
`performanceMode` is sent (SetupPanel "Configure for me", `SetupPanel.tsx:80`), `MODE_PRESETS[mode]`
unconditionally overwrites `kvCacheType`/`flashAttn` (balanced/extreme = f16/off) and persists the
clobber — silently wiping the user's explicit q8_0. Fingerprint: on-disk `llm-settings.json` holds
`kvCacheType:"q8_0"` next to `performanceMode:"balanced"` (contradiction). Fix: the preset must
MERGE — set only fields the user hasn't explicitly overridden — and the granular KV control + the
mode picker should live on one screen so the interaction is visible.
**UNCONFIRMED (verify in fix):** the user reports the revert on EVERY restart, not just after
touching the mode picker — suggests a boot-time re-apply of the preset re-clobbering KV. The fix
must trace + close the every-restart path, not just the picker path.

**T1f. Thinking/reasoning never persisted.** `addRagMessage` has no reasoning field;
`mapRagMessages` (`:124`) doesn't restore it. Reasoning shows live but is gone on the next
conversation remap/reload. Fix: thread reasoning through `addRagMessage` into stored context,
restore in `mapRagMessages`.

### TIER 2 — minor / adjacent (lower priority)
- `ctxSize` also silently halved + persisted by crash recovery (`llm.ts:479-483`) — a non-user
  mutation of a user setting (maybe intended; make it non-destructive or surfaced).
- `Settings.tsx:406` identity fields save on `blur` not `change` — edit lost if closed without blur.
- VoiceScreen residency toggle: fire-and-forget, no reconcile; ActionsScreen prop-resync gap.
- Preload `setLlmSettings` type omits kvCacheType/flashAttn/gpuLayers/threads/batchSize/mode — a TS
  typing gap only (runtime passes the whole object), but it hides those fields from type-checking.

### TIER 3 — ephemeral view prefs (likely by-design; optional)
- ReplayScreen playback `speed`/`asideW`, ReflectScreen day/week `mode` reset on remount. No
  authoritative owner to diverge from — not the drift class; persist only if desired UX.

### Confirmed CLEAN (correct write-through / refetch-bound — the reference pattern)
SettingsPanel (all LLM inference controls), ModelPicker (per-modality active model), Projects,
Connectors, ChatDetail, DayView (persisted layout with get + write-back — the good reference),
MeetingsScreen, ReflectScreen, composer chat-prefs (noMemory/tools/connectors/thinking/voice).

**Note on sweep reliability:** the pro/meetings agent initially FABRICATED findings
(`autoRecord`/`tone`) and self-corrected on a re-run; those are excluded. Pro is largely clean of
the real drift class. Treat any single-agent finding here as verified against source before fixing.

---

## RESOLVED

### Agentic `generate_image` tool errored (stale keep-alive socket in the tool loop)

**Status:** RESOLVED. ECONNRESET root cause fixed + regression-guarded; the tool path works in
every programmatic reproduction (4 ways, below) AND was confirmed working in the real UI —
observed live: with Tools on and no project, "use your built-in image tool …" routed through the
agentic `generate_image` tool and the image rendered in the reply. The one earlier UI "Sorry"
was on a run whose Tools-toggle/grounding was unreliable (pre the provit DOM-grounding fix), not
the engine fix. Closed.

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

**Verified (programmatic, 4 ways):** in-process against the real `window.api.toolChat` — non-
streaming, streaming (with `streamId`), full UI-faithful (real `imageGenStatus()` → `toolChat`
→ deferred `generateImage`, which wrote `img-*.png` to disk), and with a 44k-char / 7471-token
history — ALL return `toolCalls: ["generate_image"]` + `imageRequest`, no ECONNRESET, warm and cold.

**NOT yet verified:** a clean pass through the real vision-driven UI (provit). One provit UI run
post-fix still showed "Sorry"; could not reproduce it programmatically. Leading suspicion:
sustained background load during the long provit run (the `[layout] learn` task hammering the
model with mmproj-500s) puts the engine/queue in a state my quick repros don't hit — UNCONFIRMED.
A UI-drive attempt to reconcile failed on selectors (nothing sent), so it's still open.

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
