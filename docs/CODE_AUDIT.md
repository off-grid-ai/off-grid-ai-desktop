# Codebase SOLID/DRY audit (2026-07-09)

Read-only audit via parallel agents over disjoint areas. Evidence-based (file:line + quoted
smell). This is a BACKLOG for a decision on scope — NOT auto-fixed. Ranked by severity within area.
Fixing is a separate, deliberate effort (a SOLID refactor is behavior-risk; each item needs its
own change + tests). Real BUGS (not just smells) are marked 🐞.

## Highest-value / real bugs first — ALL RESOLVED (this branch)
- ✅ 🐞 **3 divergent ext→MIME maps** — fixed in `fix(mime)`: one `mimeForExt(ext, fallback)` map in `src/main/mime.ts`; index.ts / media-server.ts / data-url.ts all delegate. Tested (`__tests__/mime.test.ts`).
- ✅ 🐞 **`.webp` mislabeled** — fixed in `fix(mime)`: `tools.ts` routes attachments through `mimeFromExt` → `image/webp`. Source-read regression guard added; gif→image/gif corrected too.
- ✅ 🐞 **picker allowlist vs processor router disagree** — fixed in `fix(upload)`: `files-classify.uploadPickerExtensions()` derives the dialog filter from the router's IMAGE/AUDIO/VIDEO + DOC sets. Tested (picker⊇router, every offered ext classifies).
- ✅ 🐞 **double intent decision (root of the image-gen-as-tool bug)** — fixed in `fix(chat)`: `shouldAutoRouteImage()` in `image-intent.ts` suppresses the renderer's keyword auto-route when the agentic path owns the turn. Unit + render-harness wiring tests (tools ON → toolChat, not generateImage).

## STRUCTURAL root cause (the §A drift class)
- **The renderer has NO store layer** (`src/renderer/src/stores/` does not exist). Every screen re-fetches + holds its own `useState` copy — the reason the "local copy that drifts" bug keeps recurring (image composer, ProjectsScreen doc-toggle, etc.). A thin per-domain store (owns the authoritative fetch + write-through) would prevent the class structurally instead of fixing it screen-by-screen.

## Core services (src/main) — DIP/SRP/DRY
1. DIP — `imagegen.runImageGen` (403/464/540/593): 4 interchangeable runtimes (mflux/coreml/sd-server/sd-cli) chosen by predicate cascade in one 350-line fn; a 5th needs edits in ≥3 places. Fix: `ImageRuntime` interface + priority registry.
2. DIP+SRP+DRY — `tools.ts:336`: the tool loop `if (c.name==='search_memory'){…} else if ('generate_image'){…}` ignores each tool's own `run()`; search logic duplicated. Fix: `ToolDef.run(args, ctx)` returning `{text,sources?,imageRequest?}`; loop dispatches uniformly.
3. SRP — `imagegen.ts:56-306`: listing/delete/LoRA/GGUF-sniff/resolve-policy/orchestration in one file. Fix: split model-resolve / gguf-inspect / loras.
4. DRY — `llm.ts` `chatStream` (635) vs `streamChat` (706): ~40-line SSE transport written twice. Fix: one `streamCompletion(port,body,{onDelta,onToolCall?,signal})`.
5. DRY — ffmpeg 16k-mono re-encode copy-pasted 3× (whisper-cli:137, whisper-server:321, parakeet-cli:194). Fix: `transcription/ffmpeg-decode.ts` `withDecodedWav()`.
6. DRY — `isValidGguf` byte-identical in models-manager:364 and llm.ts:324. Fix: shared `models/gguf.ts`.
7. DIP — `models-manager` `runtime==='mflux'` branch in download/delete/cached (124/225 + catalog-logic:104). Fix: fold install/delete/isCached into the runtime abstraction (#1).
8. DRY — search facet LIKE clauses (search.ts:158) duplicate the hit builders (254/272/288); facet counts can disagree with results. Fix: `likeMatcher(columns)` shared.
9. DRY — whisper-server `findBinary` (136) hand-rolls what `bin-resolution.existing()` owns.
- lower: whisperModel/smallWhisperModel sort-sign dup; tts.ts free-functions+module-state (YAGNI ok, 1 engine); LoRA ext regex 3×; Z-Image companion regex dup (guard sizes ≠ run loads — correctness risk); epoch-ms strftime idiom ~6×.

## Core data/ipc/renderer — DRY/§A/SRP
- artifact-kind→label defined 3× + already drifted (artifacts.ts:76 ↔ ArtifactCanvas:13 ↔ ProjectsScreen:30). Fix: `shared/ARTIFACT_KIND_LABELS`.
- image-model preference heuristic re-implemented in renderer (MemoryChat:469) duplicating main `defaultImageModelFilename`. Fix: `imageGenStatus()` returns the resolved default.
- model-kind→label map dup (ModelsScreen:110 ↔ StoragePanel:30). Fix: `MODEL_KIND_LABELS` in `@offgrid/models`.
- ProjectsScreen doc-toggle (507): optimistic flip not derived from result, never refreshes on failure → §A drift.
- ipc.ts:490-918 `rag:chat`: SRP god-handler; app-name LIKE clause rebuilt 7×; 5 near-identical FTS blocks. Fix: `retrieveContext()` + `ftsBlock()` + `appNameFilter()`.
- `modalityQueue.run({tier:2,label:'chat',evicts:['image']})` literal 4× → export `CHAT_JOB`.
- sessionId parse dup (ChatDetail:237 ↔ ChatList:34); SQLite-UTC time parse inlined 3× (lib/time.ts is the home); 3 drifted `markdownComponents` maps (ChatList link cyan violates emerald token); ConnectorsScreen SETUP_HINTS is catalog data living in the view.
- SRP refactor-scale: `database.ts` (1339 lines — key mgmt + cosine + DDL/migrations + 6 domains' queries). Fix: connection/schema/per-domain repos + `vector-math.ts`.
- out-of-scope tickets: ModelsScreen/StoragePanel use `@tabler/icons-react` (CLAUDE.md mandates Phosphor-only).

## Pro main — DIP/SRP/DRY (15 findings)
Top consolidation targets (each closes several):
1. **`crm/text-sim.ts`** — `charSim`(agent-rank:50) vs `charSimilarity`(resolve:74) dup, the twice-written fuzzy-scan (`findEntityIdByNameFuzzy` resolve:47 vs `findNearDuplicate` resolve:106), + the 0.82/0.86/0.88 threshold ladder. Highest DRY payoff, name-match-integrity critical.
2. **`ConnectorIngestor` interface** — `ingest.ts:99-113` dispatches on connector identity (URL substring + tool-name sniff); `ingest-helpers` categoryFor/buildArgs/pickReadTool key behavior off name/schema regex. Adding a connector edits ≥4 fns. Fix: per-connector object declares category/buildQuery/pickTool; dispatcher picks first matches().
3. **`emitCrmChanged()` single owner** — `BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('crm:changed'))` defined 2× + inlined 4+ (observations:149, approvals:44/101, actions:225, meetings:66); channel string spread 8×.
4. **`surfaceCapabilities(name)` registry** — email/calendar surface special-cased by literal name in agent:72/96, ahead:106, extract:96, calendar:49. Adding Outlook/Apple Mail edits every site.
Other DRY: `PRIORITY_RANK` authored twice (actions.ts:250 SQL CASE vs priority-sort.ts:13 TS); `norm()` 3× (cleanup:6/resolve:58/session:64); `dayKey` (calendar:57 vs ahead:81); self-matcher `isMe`(identity:97) vs `isSelfName`(cleanup:12); bundled-binary resolver dup (push-to-talk:14 vs meeting-native:21).
DIP: `dictation/controller.buildSinks:448` hardcodes concrete sink classes per flag → inject a SinkFactory.
SRP (sequence AFTER seams): `agent.proposeActions` (53-252), `extract.extractObservationFromScreen` (250-416), `vault-service` unlock/recovery — inject a VaultStore.
The new *-helpers/-rank/-heuristics/-window siblings are clean pure seams; violations are in their callers.

## Progress (this branch pair — fix/honest-pro-coverage + test/pro-coverage-campaign)
RESOLVED so far, each behavior-neutral + tested + coverage floor held (97/92/95/98):
- Core: all 4 real 🐞 bugs (above); `isValidGguf` shared (`models/gguf.ts`); artifact-kind +
  model-kind label maps shared (`lib/artifact-labels.ts`, `lib/model-kind-labels.ts`).
- Pro: `crm/text-sim.ts` (charSim/normalizedCharSim/numbersDiffer/nameSimThreshold/bestFuzzyMatch —
  closed the charSim dup + twice-written fuzzy scan + threshold ladder); `PRIORITY_RANK` single
  source (Actions ORDER BY generated via `priorityRankCaseSql`, no more TS-vs-SQL drift).

REMAINING (larger DIP interfaces + SRP god-file splits — each genuinely behavior-risk, best done
one at a time with its own verification; NOT yet started):
- Core DIP: `ImageRuntime` interface (imagegen 4-runtime cascade); `tools.ts` `ToolDef.run` dispatch;
  imagegen.ts SRP split; llm.ts `streamCompletion` dedup (chatStream vs streamChat); transcription
  `ffmpeg-decode` dedup (3×); search `likeMatcher`; models-manager mflux-branch fold.
- Core lower DRY: markdownComponents 3× (incl. ChatList cyan → emerald token); ipc.ts `retrieveContext`
  god-handler split; database.ts split (1339 lines); `CHAT_JOB` const; sessionId/UTC-parse dups;
  ModelsScreen/StoragePanel `@tabler` → Phosphor (CLAUDE.md mandate).
- Pro: `ConnectorIngestor` interface; `emitCrmChanged` single owner (+ `crm:changed` const);
  `surfaceCapabilities` registry; residual `norm`/`dayKey`/`isMe` dups; dictation `SinkFactory`;
  agent/extract/vault SRP splits.

## Scope note
This is a DIAGNOSIS backlog. A SOLID/DRY refactor of this size is behavior-risk. The safe,
high-payoff DRY consolidations + all 4 real bugs are DONE on the branch pair above. The remaining
DIP/SRP items each change interfaces or split god-files and should land as their own reviewed
changes (per-item tests, individual verification) rather than a single blind sweep.
