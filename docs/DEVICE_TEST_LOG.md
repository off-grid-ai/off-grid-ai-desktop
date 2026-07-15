# Device test log — QA bug hunt (feat/consolidation-and-coverage)

Adversarial QA sweep of the desktop app: 6 read-only agents hunting to PROVE THE
CODE WRONG across download, chat (streaming / tools / MCP / modality), projects,
model settings, and the Settings surface. Every item below is **code-traced to a
real path + a user-visible symptom** — but **NONE is yet verified on-device**.

This is the fix-then-verify list: each bug gets a red-first regression test (assert
the TERMINAL artifact — the persisted row / rendered bubble / file on disk — across
the untested intersection), the fix, then a manual on-device check ticked here.

Status: `[ ]` open (found, not fixed) · `🔁` fixed, needs on-device recheck · `[x]` ✅ verified on device.
Severity in **CAPS**. `§A` = data-layer/presentation drift · `ARCH` = SOLID/DRY/SoC/open-core.

All 35 were found in UNTESTED intersections — the default-config trap (suite sits at
single-conversation / happy-path / one-model / non-empty-profile), so the other axis
value had zero coverage.

---

## Download & storage

- 🔁 **D1 CRASH** — FIXED (needs on-device confirm). Download write errors (disk full / EIO) emitted an unhandled `'error'` → whole-app crash, and the finish-wait hung. Fix: extracted `pumpToFile` (models/download-pump.ts) owns the error path → rejects → status 'failed'. Test: `download-pump.test.ts` (real write stream; ENOENT → graceful reject; naive version times out = the bug, falsified). **On-device:** fill the disk (or point models dir at a tiny volume), start a large download → it shows Failed, the app stays up (no crash), chat/capture keep working. `models-manager.ts` + `models/download-pump.ts`
- [ ] **D2 DATA-LOSS** — A truncated / short-read download is promoted to "installed" + activatable (no `written===content-length` or GGUF-magic check before rename) → activating it kills llama-server ("Chat model Down", no reason). `models-manager.ts:179`
- [ ] **D3 CORRUPT** — Double-clicking Download (or Retry while it's already downloading) runs two writers into one `.part` → corrupt file; Cancel then controls the wrong download. `models-manager.ts:123`
- [ ] **D4 DISK-LEAK** — Cancel/Clear deletes the `.part` while a writer is still running → an orphan `.part` is recreated, invisible in the Downloads list, silently leaking GBs. `models-manager.ts:525,535`
- [ ] **D5 LEAK** — Navigating away from Storage during a live download → setState on the unmounted StoragePanel (in-flight `getStorageInfo`/progress). `StoragePanel.tsx:41-54`
- [ ] **D6 WRONG-STATE** — Deleting the ACTIVE image model doesn't deactivate it (delete compares id, but the image pick is stored as a filename) → dangling active pointer, next image gen fails to load. `models-manager.ts:249`
- [ ] **D7 SILENT-WRONG** — "Configure for me" reports success even when the llama `/health` check fails (result computed then ignored) → user is let into a dead-chat app. `setup.ts:279`

## Chat — streaming & send/resend lifecycle

- 🔁 **D8 WRONG-CONVERSATION** — FIXED (needs on-device confirm). Send history was built from the ACTIVE tab's `messages`, not the target conversation → a drained-queue/background send got another conversation's context. Fix: `buildSendHistory(messagesByConv[convId], …)` (extracted, pure). Test: `chat-history.test.ts` (rule + source guard; red on HEAD). **On-device:** in conversation A ask something long; while it streams, queue a follow-up in A, switch to B; when A's queued send fires, A's reply must reference A's thread (not B's). `lib/chat-history.ts`, `MemoryChat.tsx`
- [ ] **D9 CROSS-CONVERSATION** — Stop on conversation A clears the GLOBAL `loading`/`generatingImage`/`imgProgress` → conversation B's spinner + Stop button vanish; B can't be stopped and its image progress renders in the wrong tab. `MemoryChat.tsx:1075-1077`
- 🔁 **D10 TRUNCATION** — FIXED (needs on-device confirm). `chatStream` ignored the caller's `maxTokens` (`this.maxTokens || maxTokens`) → capped at the setting. Fix: shared `resolveMaxTokens` (`requested ?? setting`) across chat/chatStream/streamChat. Test: `llm/__tests__/gen-params.test.ts` (rule + source-contract guard; red on HEAD). **On-device:** raise "max response length" → a long answer streams past the old 2048 cap. `llm/gen-params.ts`
- [ ] **D11 STUCK** — Stop during the pre-token phase ("Searching your memory…" / intent-classify / image-prompt) doesn't abort the main-process `llm.chat` (no AbortController on the non-stream path) → model stays busy, the next send blocks behind it. `ipc.ts:51-60`, `llm.ts:552`
- [ ] **D12 LOST-CONTENT** — A tool-image turn cancelled during image generation persists nothing → the answer shows in the UI but is gone on reload (only the user turn was saved). `MemoryChat.tsx:938-942`
- [ ] **D13 STUCK-LABEL** — Stop-with-partial after a `step` delta strands the "Working…/Searching…" activity label on the finalized bubble (the cancel finalize doesn't clear `activity`). `MemoryChat.tsx:966`
- [ ] **D14 MISLEADING** — Empty-profile "All memory" chat error shows the same generic "Sorry, something went wrong" as a real crash — no "nothing here yet" state. `ipc.ts:600+`, `MemoryChat.tsx:1026`

## Chat — tools / MCP / modality

- 🔁 **D15 ACTION-AFTER-CANCEL** — FIXED (needs on-device confirm). Stop mid-round still ran the assembled tool (incl. MCP writes — send message/create event), invisibly. Fix: `toolChat` returns immediately after a round if `signal.aborted`, before `runTool`. Test: `tools-abort.test.ts` (fake MCP tool's side effect never fires after abort; red on HEAD → green). **On-device:** connect an MCP write connector (Slack/Calendar), ask something that triggers its tool, hit Stop as it "thinks" → confirm NO message/event is actually created. `tools.ts:374+`
- 🔁 **D16 WRONG/EMPTY** — FIXED (needs on-device confirm). Image attached to a text-only model was embedded as `image_url` unconditionally (no main-side guard). Fix: gate embed on `llm.hasVision()` in main (single source of truth). Test: `tools-vision-guard.test.ts` (crosses both vision values; no-vision → no image_url at the engine boundary; red on HEAD). **On-device:** with a text-only chat model active + Tools on, attach an image → the model answers text-only without erroring (no vision garbage). `tools.ts:346`
- 🔁 **D17 SILENT-DROP** — FIXED (needs on-device confirm). A connector whose token expired / server is down silently lost its tools with no status change. Fix: the loader marks it `error` via `setConnectorStatus`. Test: `mcp-connector-status.dbtest.ts` (real DB; failed load → status 'error'; red on HEAD). **On-device:** connect a connector, revoke/expire its token, chat → the connector shows an error/reconnect state in Integrations (not a phantom "connected"). `mcpConnectorToolExtension.ts`, `mcp.ts`
- 🔁 **D18 SLOW/STUCK** — FIXED (needs on-device confirm). Per-turn connector loads were serial + unbounded → one dead connector hung every turn. Fix: `fetchTools` races an 8s timeout; the loader fetches all connectors concurrently. **On-device:** with several connectors (one unreachable), a chat turn still starts promptly (≤~8s worst case, not a hang). `mcp.ts` (fetchTools), `mcpConnectorToolExtension.ts`
- [ ] **D19 WASTED-CYCLE** (minor) — Cancel between a `generate_image` tool turn and the deferred image job triggers a needless LLM evict/re-warm → the next turn stalls seconds for nothing. `MemoryChat.tsx:933-940`

## Projects

- 🔁 **D20 DATA-ORPHAN + BROKEN-PROMISE** — FIXED (needs on-device confirm). `deleteProject` swept the dead `project_threads` backend but never `rag_conversations` (where project chats live) nor artifacts → orphaned chats badged to a phantom project. Fix: `deleteProject` now also deletes `rag_conversations` + `rag_messages` (explicit — FKs are off) and calls `deleteArtifactsForProject`. Test: `project-delete-cascade.dbtest.ts` (chat+messages+artifact all gone; red on HEAD, falsified). **On-device:** make a project, chat in it (generate an artifact), delete the project → the chats vanish from the sidebar and the artifact is gone from the gallery. `store.ts:239`, `artifacts.ts`
- [ ] **D21 WRONG-ATTRIBUTION** — Switching project scope mid-stream misattributes the artifact/image: the send locks `convId` but reads `activeProjectId` LIVE at each await → Project-A output lands in Project B (cross-project leak). `MemoryChat.tsx:958,982,1009,591`
- [ ] **D22 ARCH (SoC/DRY, dead system)** — Two parallel project-chat backends: the UI writes `rag_conversations`; `project_threads`/`project_messages` + `projectChat` + `listProjectThreads` are dead (no caller) yet `getProjectChatHistory` UNIONs both → two sources of truth. `rag-ipc.ts:90-105`
- [ ] **D23 ORPHAN** — Artifacts have no lifecycle tie to a conversation/project — deleting a chat or project never deletes its artifacts → they linger in the "all" gallery forever, unbounded disk growth, a deleted chat's HTML still openable. `artifacts.ts`, `MemoryChat.tsx:707`
- [ ] **D24 STALE-UI §A** — ProjectsScreen's project list and MemoryChat's project list are independent `useState` snapshots with no cross-invalidation → rename/create/delete in one surface doesn't refresh the other (stale name/count). `ProjectsScreen.tsx:106-121`, `MemoryChat.tsx:270`
- [ ] **D25 LATENT** — `getRagConversations` tri-state arg (`undefined`=all / `null`=unscoped / id) is a sharp untested edge — a caller passing `null` expecting "all" gets only orphan chats. `database.ts:1152`

## Model settings / activation / residency

- [ ] **D26 SILENT-LOST + DRY** — "Configure for me" NEVER activates TTS: it passes `kind:'voice'` but `isModalKind` accepts only `'speech'` → `setActiveModalChoice` fails, error swallowed; Kokoro shows not-Active though setup claims "voice is set up". `setup.ts:289,295`, `catalog-logic.ts:232`
- [ ] **D27 SILENT-LOST §A** — An in-flight Steps/size edit is stomped by the `[imgModel,imgParamStore]` re-seed effect on model switch → the field resets to default and the generate call uses the default, not your value. `MemoryChat.tsx:545-550`
- [ ] **D28 PANEL-DESYNC / DRY (latent)** — Residency UI shows a stale `on-demand` for the locked `llm` modality; the renderer doesn't run `normalizeResidency`'s lock-coercion (the rule is duplicated across main/renderer). `Settings.tsx:146`

## Settings surface

- 🔁 **D29 DATA-LOSS / PRIVACY** — FIXED (needs on-device confirm). "Delete all my data" cleared only CHAT_TABLES + MEMORY_TABLES + user_profile, so the capture corpus (observations, frames, entity_aliases, secretary_prefs, action_items, clipboard_items, day_journals, voice_recordings…) + rag_documents/chunks survived. Fix: a `personalStores` registry (core) that pro extends via `registerProPersonalData()` in activateMain — single source of truth, open-core clean. Tests: `data-privacy-delete-all.dbtest.ts` (core: rag docs gone), `pro/main/__tests__/personal-data.integration.test.ts` (pro: observations gone). **On-device:** seed real captures/clips, "Delete all my data", confirm Day/Entities/Clipboard/Search all empty. `data-privacy.ts` + `pro/main/personal-data.ts`
- 🔁 **D30 PRIVACY / SECURITY** — FIXED (needs on-device confirm). "Delete all" never cleared `secrets` (OAuth tokens) or `connectors` → live third-party credentials remained. Now both are in the core registry. Test: `data-privacy-delete-all.dbtest.ts` (connectors + secrets → 0 after wipe; red on HEAD, falsified). **On-device:** connect an OAuth connector, "Delete all my data", confirm the connector is gone and reconnect requires fresh auth. `data-privacy.ts`
- [ ] **D31 ARCH (open-core + dead seam)** — Pro Settings sections (Proactive / Secretary / Plan) are defined & rendered inline in CORE gated by `isPro`; the `registerProSettings → sectionRegistry` seam is a dead stub → pro business logic ships in the public repo AND the mandated registry seam is unused. `Settings.tsx:75-397,464-497`, `pro/renderer/settings.ts:5`
- [ ] **D32 DEAD-FEATURE** — `memoryStrictness`/`entityStrictness` are plumbed + read (default `balanced`) but have NO UI control → permanently stuck at `balanced`. `ipc.ts:195,252`
- [ ] **D33 PANEL-DESYNC §A** — `resetDefaults` merges `DEFAULTS` into local state but persists `DEFAULTS` alone → any engine field absent from the `DEFAULTS` literal diverges shown-vs-used. `SettingsPanel.tsx:67-70`
- [ ] **D34 PANEL-DESYNC §A** — Optimistic toggles (auto-update/beta, proactive, residency, TTS voice, tool-enable, connector-enable) call `setX(next)` without awaiting/checking the persist → on write failure the switch shows the new state while the engine keeps the old; the next mount silently stomps it. `Settings.tsx:194-206` (+ siblings)
- [ ] **D35 RACE** — Delete-category / delete-all while capture or chat is running has no guard — a concurrent capture write races the delete (resurrected orphans) or the live lancedb handle is dropped mid-use (replay error). `data-privacy.ts:161`

---

## Cross-cutting themes (for the fix pass)

- **Cancel/Stop is not honored at the boundary** (D11, D12, D15, D19): abort sets a renderer flag but the main-process job keeps running — tools fire, models stay busy, content is lost. Fix at the seam: thread the AbortSignal all the way and check it before every side-effect.
- **Global state where it should be per-conversation** (D8, D9, D13): history + loading/progress are read/written globally, so a second conversation corrupts the first. Fix: key them by `convId`, capture `activeProjectId` into the send closure like `convId` already is (D21).
- **"UI keeps its own COPY of authoritative data" (§A)** (D24, D27, D28, D33, D34): re-seed effects and optimistic setX drift from the owning source. Fix: read reactively + write through; a per-render default is a pure function of the source, not a stored duplicate.
- **DRY breaks across main/renderer or code/schema** (D22, D26, D28, D29): a rule/key/table-list defined twice drifts. Fix: one source of truth, imported by both sides (delete-all should derive from the schema, not a hand-listed subset).
- **Data-privacy correctness** (D29, D30, D35): the single most user-critical class — a "wipe" that doesn't wipe, and leftover credentials. Fix + a test that asserts EVERY personal table/store is empty after delete-all.
- **Open-core** (D31): pro logic in core + a dead registry seam.

## Related

- `docs/RELEASE_TEST_CHECKLIST.md` — the branch's intended-change manual checklist (separate from this broken-flow log).
- `docs/GAPS_BACKLOG.md` — will get a linked entry per bug as it's picked up.
