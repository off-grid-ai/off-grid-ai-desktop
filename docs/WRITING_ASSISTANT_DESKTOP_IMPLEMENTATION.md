# Writing Assistant — Desktop implementation plan

Scope: **desktop only** (this repo). Engine is built pure/portable so mobile lifts it later, but no mobile work here. Companion doc: `WRITING_ASSISTANT_PLAN.md` (why/what). This doc is the how.

Guiding rules (from CLAUDE.md): engine depends on abstractions (injected LLM + store); reusable engine is Electron-free; pro feature code lives in `pro/`, core carries only the inert shell; reuse existing components before building; verify with `tsc` + tests each phase; PR evidence (screenshots/video) per surface.

---

## 0. Architecture at a glance

```
packages/writing/  (PURE TS — no electron, no react)     ← the portable engine
  types.ts        Issue, WritingSettings, RewriteRequest, engine + port interfaces
  segment.ts      sentence + token segmentation
  spell/          SymSpell (symmetric-delete) + frequency wordlist asset
  rules/          rule DSL + starter catalog (write-good/proselint-style)
  postag.ts       lightweight POS (lexicon + suffix heuristics) — optional v1
  proofread.ts    RuleProofreader (sync) + LlmProofreader (via CompletionClient)
  rewrite.ts      LlmRewriter (tone/rephrase/translate/report) via CompletionClient
  merge.ts        dedup + rank + severity across rule/llm sources
  ports.ts        CompletionClient, ContextStore interfaces (injected)
  index.ts        WritingService facade
        │ imports NOTHING from the app
        ▼
pro/main/writing/  (desktop main — the integration)
  completion.ts   CompletionClient impl over core llm / gateway
  context.ts      ContextStore impl over crm resolve/rag/preferences/observations
  service.ts      wires WritingService with the two adapters + settings persistence
  ipc.ts          writing:* IPC handlers
  controller.ts   WritingController (system-wide: hotkey→read→engine→overlay→apply)
  read-selection.ts / apply-edit.ts   native read + range-replace
        ▼
pro/renderer/  (desktop UI)
  components/writing/writingApi.ts     proInvoke/proOn wrapper (writing:*)
  components/writing/AssistedTextarea  textarea + squiggle overlay + popover
  components/writing/RewriteToolbar     selection actions (tone/rephrase/translate)
  screens/WritingOverlay.tsx            system-wide suggestions panel
  settings/WritingSettings.tsx          settings section
```

The two ports are the whole SOLID story: engine never imports Electron; desktop supplies `CompletionClient` (the model) and `ContextStore` (the shared brain). Mobile later supplies its own two adapters, zero engine change.

**Placement decision:** build the engine as `packages/writing/` in this repo now (mirrors the existing local `packages/design/`), with the hard invariant of **zero Electron/React imports** so it lifts to `shared/@offgrid/writing` unchanged when mobile arrives. Flagged in §8.

---

## Phase 0 — The engine (`packages/writing/`), pure + tested

No app wiring. Builds and is tested standalone before anything imports it.

**0.1 Contracts** (`types.ts`, `ports.ts`)
```ts
interface Issue {
  span: [start: number, end: number];
  category: 'spelling'|'grammar'|'punctuation'|'style'|'clarity'|'tone'|'word-choice';
  severity: 'error'|'warning'|'suggestion';
  message: string;
  replacements: string[];
  source: 'rules'|'llm';
  ruleId?: string;
}
interface CompletionClient {                 // injected — the model
  json<T>(prompt: string, schema: object, opts?: {maxTokens?: number}): Promise<T>;
  stream(prompt: string, onToken: (t: string) => void, opts?: {maxTokens?: number}): Promise<string>;
}
interface ContextStore {                      // injected — the shared brain
  knownTerms(): Promise<Set<string>>;         // entity names+aliases → never-flag
  styleContext(text: string): Promise<string>;// RAG voice + learned-prefs doc
  recordAccepted(edit: AcceptedEdit): Promise<void>;
  recordFeedback(f: EditFeedback): Promise<void>;
  teachTerm(term: string): Promise<void>;
}
```

**0.2 Segmentation** (`segment.ts`) — sentence split + tokenizer with char offsets (spans must map back to the original string exactly). Pure, unit-tested on tricky cases (abbreviations, URLs, emoji).

**0.3 SymSpell speller** (`spell/`) — build from scratch (algorithm public, §1a of the plan doc):
- precompute delete-index from a frequency-ranked wordlist asset (ship a compact EN list);
- lookup: query-deletes → candidates → verify Damerau-Levenshtein ≤2 → rank by frequency;
- respect `customDictionary` + `ContextStore.knownTerms()` (never flag those).
- Unit tests: known misspellings → expected top suggestion; known words → no flag; custom term → no flag.

**0.4 Rule engine** (`rules/`) — our own compact DSL (JSON/TS), not LanguageTool XML. Each rule: matcher (literal | regex | POS | phrase-map) → Issue with message + replacements. Starter catalog = the write-good/proselint set:
- passive voice, weasel words, adverb-weakeners, wordy phrases (`in order to`→`to`), repeated words, clichés, sentence-start `so`/`there is`, double spaces, punctuation basics.
- Each rule is a pure function `(tokens, text) => Issue[]`; catalog is data. Unit-test each rule with a positive + negative case (regression guard per CLAUDE.md).

**0.5 POS tagger** (`postag.ts`) — lexicon lookup + suffix heuristics (`-ly`→RB, `-ing`→VBG) + a few Brill-style fixups. Only needed by grammar rules that require word class; v1 can ship the regex/word-list rules without it and add POS-dependent rules later. Decision in §8.

**0.6 LLM proofread + rewrite** (`proofread.ts`, `rewrite.ts`) — CoEdIT-style instruction prompts:
- `LlmProofreader`: `CompletionClient.json` with a strict schema returning `{issues:[{span,category,message,replacements}]}` over a bounded chunk; for heavy grammar/GEC the rule engine can't do.
- `LlmRewriter`: `CompletionClient.stream` with templated instructions built from `WritingSettings` (tone/audience/formality/domain) + `ContextStore.styleContext()` prepended. Actions: rewrite, tone-shift, shorten, expand, simplify, translate, report.
- Prompt templates guarded by a regression test that reads the source (per CLAUDE.md `extract-prompt.test.ts` pattern).

**0.7 Merge + facade** (`merge.ts`, `index.ts`) — dedup overlapping spans (rules win on spelling, llm on grammar), rank by severity+position. `WritingService` exposes `checkSync(text)` (rules only, instant), `checkFull(text)` (rules+llm), `rewrite(req, onToken)`, `report(text)`.

**Deliverable:** `packages/writing` builds; `npm test` green; zero app imports. Nothing wired yet.

---

## Phase 1 — Main-process integration (`pro/main/writing/`)

**1.0 (first task) Verify the model transport.** Confirm `@offgrid/core/main/llm` supports (a) grammar/JSON-constrained output and (b) token streaming. If yes, `completion.ts` wraps `llm.chat`. If not, wrap the gateway directly: `callLlamaJson` (JSON) + `proxyToLlama`/SSE (stream) from `src/main/model-server.ts`, with `chat_template_kwargs:{enable_thinking:false}` + `response_format` for the JSON path. This unblocks 0.6's assumptions.

**1.1 `completion.ts`** — `CompletionClient` impl (json + stream) over the chosen transport.

**1.2 `context.ts`** — `ContextStore` impl over the shared brain (all seams already exist):
- `knownTerms()` ← entity names+aliases (`pro/main/crm/resolve.ts`).
- `styleContext(text)` ← `ragService.searchProject(...)` (`src/main/rag/index.ts`) + `getPreferenceDoc()` (`pro/main/crm/preferences.ts`).
- `recordAccepted()` ← `recordObservation({surface:'WritingAssistant', ...})` (`pro/main/crm/observations.ts`).
- `recordFeedback()` ← `recordFeedback()`; `teachTerm()` ← `addAlias()`.

**1.3 `service.ts`** — instantiate `WritingService(completion, context)`; load/persist `WritingSettings` via core settings store.

**1.4 `ipc.ts`** — `writing:*` handlers (mirror `pro/main/dictation/ipc.ts`):
`writing:get-settings` / `set-settings` / `check` (sync rules) / `check-full` / `rewrite` (streams via `writing:rewrite:token` events) / `report` / `apply` / `teach-term` / `feedback` / `invoke-systemwide`.

**1.5** Register `setupWritingIpc()` + `writingService.start()` in `pro/main/services.ts` (next to dictation).

**Tests:** `context.ts` against a temp SQLite + LanceDB (integration, per CLAUDE.md real-collaborator preference); `completion.ts` transport smoke test.

---

## Phase 2 — In-app UI (`pro/renderer/`), the everyday surface

**2.1 `writingApi.ts`** — proInvoke/proOn wrapper for `writing:*` (mirror `voiceApi.ts`).

**2.2 `AssistedTextarea` (the one hard component, built once, reused).** Reuse check: no existing overlay/decoration component exists → net-new, justified. Technique: a `pointer-events-none` mirror `<div>` absolutely positioned over the `<textarea>`, same font metrics/padding, scroll-synced; render issue spans as underlined segments. Debounced `writing:check` (rules, instant) on change; tap an underline → popover with `replacements` → apply edits the controlled value. Wrap the existing `MemoryChat` textarea (`src/renderer/.../MemoryChat.tsx`) and the notes/knowledge textareas via this one component.

**2.3 `RewriteToolbar`** — on selection, a small floating bar (reuse `dropdown-menu`/`badge`/`button` from `components/ui/`): Rewrite, Tone▾, Shorten, Simplify, Translate▾. Streams the result into a diff preview (accept/reject). On accept → apply + `writing:feedback`/`apply` (fires `recordAccepted`).

**2.4 `WritingSettings` section** — register via `registerProSettings` (`pro/renderer/settings.ts`, `order:150`). Controls for the full `WritingSettings` schema (surfaces, trigger, checks, applyMode, tone, audience, formality, domain, language, translateTo, customDictionary). Reuse `AdvancedToggle`-equivalent, `select`, tokens.

**Tests:** E2E (Playwright) asserts AssistedTextarea renders an underline for a seeded misspelling and the settings section renders; screenshot both states for the PR.

---

## Phase 3 — System-wide (the headline), reuse dictation infra

**3.1 On-demand focused-field read.** Add a `--once` mode to `electron/accessibility/main.swift` (emit one `WindowContext` JSON then exit; keep the 2s poll for other callers). TS wrapper `read-selection.ts` spawns it and parses `{appName, selectedText, content}`.

**3.2 Range replace.** `apply-edit.ts`: if there is a selection, replace it (clipboard-set → synthesize paste, mirroring `pasteIntoApp` in `pro/main/text-injection.ts`); if not, offer the field's full value. Preserve/restore clipboard like `PasteAtCursorSink`.

**3.3 `WritingController`** (mirror `DictationController`): register a hotkey (distinct from dictation's Option+Space — e.g. Cmd+Opt+G) → `read-selection` → `WritingService.checkFull`/`rewrite` → show suggestions overlay → on accept `apply-edit` + `recordAccepted`. Reuse the hotkey stack (`pro/main/dictation/hotkey/`) generalized, or a second registration.

**3.4 `WritingOverlay.tsx`** — reuse the dictation overlay window (`pro/main/dictation/overlay.ts`) with a new hash route (`#writing`); non-focus-stealing NSPanel so edits land in the target app. Shows issues + rewrite actions.

**3.5 Nav/shell.** Add `proCatalog` entry (`route:'writing'`) + `proItem('writing')` so free builds show the UpgradeScreen; pro registers the real screen/overlay. Permissions reuse the existing Accessibility flow (`src/main/permissions.ts`) — no new entitlements.

**Native build:** no new helper binary needed (extends existing `accessibility` + reuses `dictation-hotkey`); if a new helper is ever added, mirror the release.yml build+stage step.

**Tests:** unit-test `read-selection` JSON parsing + `apply-edit` clipboard preserve/restore (mock electron); E2E can't drive cross-app AX → cover the controller state machine as pure logic (like `interpret-hotkey.ts`).

---

## Phase 4 — Deepen the ecosystem loop

Wire the learning flywheel fully (seams from §1.2): never-flag dictionary live from entities; RAG+prefs prepended to every rewrite; accepted edits → `recordObservation`; accept/reject → `recordFeedback` → hourly `distillPreferences` → back into `styleContext`. Add "Add to dictionary" on any spelling flag → `teachTerm`/`addAlias`.

## Phase 5 — Full-document report

LLM batch pass (`WritingService.report`) → readability, sentence-length variety, repeats, clichés, wordiness, pacing. Rendered in a panel/`sheet`. The ProWritingAid-style differentiator. Deliberately NO plagiarism (needs cloud corpus — say why).
Status: shipped a first cut — `ReviewPanel` (checkFull + 0-100 `scoreText` + applyable issue cards). Deeper report (readability/pacing metrics) still to add.

---

## Phase 6 — Import a document → transform → live edit (ROADMAP)

Drop in a file, get it rewritten the way you want, then keep editing it live. The natural "start from what I have" entry point.

- **Import:** txt / md / docx / pdf. Reuse what exists — `PDFExtractorModule` (native) for PDF, `mammoth` for docx (both already deps); md/txt read directly.
- **Transform on import:** run the imported text through `WritingService.rewrite` with a chosen action (tone / shorten / simplify / translate / "match my brand voice" — see Phase 9). Streamed, with a before/after diff to accept or discard.
- **Hand off to live edit:** the accepted result opens in `ScribeScreen`'s `AssistedTextarea` — squiggles, click-to-fix, select-to-rewrite all apply. So "transform" and "edit" are one continuous flow, not two tools.
- **Seams:** new `scribe:import` IPC (native file dialog → extract → text); the transform is the existing `rewrite`; the editor is the existing screen. Long docs chunk by paragraph for the rewrite pass (reuse the report chunking).
- **Save/export:** write the edited result back out (txt/md/docx). Small addition.

## Phase 7 — Section-level feedback (ROADMAP)

Beyond accept/reject on a single fix: select any passage and tell Scribe what you think ("too formal", "don't start sentences with 'So'", "keep my dashes"). Free-text, scoped to that selection.

- **UI:** a "Give feedback" action in the `RewriteToolbar` (selection is already captured there) → a small note input.
- **Payload:** `{ selection, note, surface }` → new `scribe:section-feedback` IPC.
- **This is the raw signal that feeds the learning loop (Phase 8).**

## Phase 8 — Learning loop + "What Scribe has learned" (ROADMAP)

Feedback isn't just logged — it's distilled into a durable understanding of how *this* user writes, shown back to them and editable, exactly like the actions/secretary "What Off Grid has learned" panel.

- **Partly exists:** accept/reject already calls `recordFeedback` → the hourly `distillPreferences` → `getPreferenceDoc`, and that doc is injected into every rewrite via `ContextStore.styleContext`. So a loop runs today.
- **The delta:**
  1. **A Scribe-specific style profile**, separate from the actions/secretary prefs doc (today they share `secretary_prefs`). New `writing_style_prefs` store so writing feedback shapes writing, not action-surfacing. Section feedback (Phase 7) + accept/reject both feed it; an hourly LLM distill folds them into durable rules ("prefers em-dashes; avoids 'leverage'; warm sign-offs").
  2. **A "What Scribe has learned" settings section** — mirror the `SecretaryPrefs` component: show the distilled style doc, let the user read/edit/clear it, show pending-feedback count. Registered via the same section-registry seam.
  3. That doc becomes the top of `styleContext`, so the more you correct Scribe, the more it sounds like you. Closed loop, visible and user-controllable.

## Phase 9 — Style-guide files as the baseline (ROADMAP)

Give Scribe the .md files that define how you write (e.g. `brand_voice.md`) and they become the authoritative baseline for every rewrite — above learned prefs, above RAG.

- **Import style guides:** upload one or more .md/.txt files in Scribe settings; stored as a named "style guide" list (`writing_style_guides`).
- **Priority order in the rewrite/companion prompt** (`styleContext` composition): (1) active style guides (declared, authoritative) → (2) learned style profile (Phase 8, inferred) → (3) RAG voice samples (observed). Declared beats inferred beats observed.
- **Per-context selection:** a style guide can be marked "always" (all copy) or scoped (e.g. only when domain='email'), so `brand_voice.md` governs all customer-facing copy automatically.
- **Token budget:** guides are summarized/trimmed to a budget before injection (reuse the preference-doc ~1800-char discipline); a large guide is distilled once into a compact rule set, cached.
- **Seams:** new `scribe:style-guides:*` IPC (add/list/remove/toggle); `ContextStore.styleContext` composes the three layers; all on-device.

---

## Phase 2.5 — Companion mode (it's a writing COMPANION, not a proofreader)

The feature has three capabilities in one surface, sharing the same shared-brain context:
1. **Fix** — correction/rewrite/tone (Phases 0-2). The Grammarly layer.
2. **Converse** — brainstorm, think-with-me, "thinking mode." Essentially a chat seeded with the current text/selection + the shared brain (entities/RAG/prefs). Another door into the existing chat engine; can "continue in chat" (create a real thread).
3. **Remember** — creates entities/observations from what you write, via the same `recordObservation` pipeline dictation uses.

- `WritingService` gains `companion(prompt, {selection?, onToken})` → builds a context-rich prompt (styleContext + selection) and streams via `CompletionClient.stream`. `companion.thinkingMode` toggles model reasoning (`enable_thinking`).
- `companion.createEntities` routes accepted content + companion turns through `recordObservation` (surface 'Writing'), so it feeds the entity/action/Reflect pipeline just like Voice.
- Mental model (user's framing): this is "another entry into the chat" — the writing surface is a lightweight, context-loaded chat that also corrects.

## Phase 3.5 — Voice integration (the products are linked)

The writing engine becomes a step in the dictation pipeline: configure grammar/tone/language ONCE, and Voice inherits it. Raw whisper transcripts are messy (no punctuation, filler words, wrong register); running them through `WritingService` before paste is the "auto-edit dictation" polish (Wispr-Flow's premium hook).

- **Shared config:** `WritingSettings` (tone, language, cleanup level, custom dictionary) is the single source; Voice reads it, with an optional per-voice override.
- **Seam:** a `WritingCleanupSink` decorator wraps `PasteAtCursorSink` — transcript → `WritingService.rewrite` (cleanup tone) → paste. Do NOT fork the dictation pipeline; insert one transform (mirrors the existing sink pattern in `pro/main/dictation/sinks/`).
- **Voice settings:** add "Clean up dictation with [Proof]" toggle inheriting the writing config.
- **Bonus:** same entity-aware dictionary + learned style applies to dictation ("email priya about acme" knows those are real names, in your voice).

**TODO (separate track, STT quality):** add **Parakeet** (NVIDIA NeMo) as a `TranscriptionService` engine alongside `WhisperCliTranscription` — whisper results aren't good enough. The `TranscriptionService` abstraction already exists (see [[dictation-feature]]), so this is a new impl behind the same interface, not a rewrite. Cleaner dictation input → cleaner writing-cleanup output, so it compounds with this feature. Scope/effort TBD (model format, on-device runtime, licensing).

## 6. Open-core placement (per CLAUDE.md) — FULLY PRO
- **Engine** `packages/writing` — tier-neutral code, but no free entry point.
- **Core:** inert shell only — `proCatalog` 'proof' entry + `proItem('proof')` → UpgradeScreen in free builds. No writing logic in core.
- **Pro** (`pro/`): the ENTIRE feature — rule proofread + LLM proofread/rewrite/tone/translate/report + system-wide controller/overlay/hotkey + deep-context wiring + settings section + voice integration. `OFFGRID_PRO=0` → locked shell only.

## 7. Testing gate (every phase)
`npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npm test`, plus E2E for new surfaces. Rule catalog + prompt templates get regression guards (read-the-source tests). PR body: before/after screenshots per surface + a short video of the golden path (type→squiggle→fix; select→tone rewrite; hotkey→system-wide), synthetic-seeded (`npm run demo`).

## 8. Decisions
- **Feature name:** it's a **writing companion** (fix + converse/brainstorm/think + remember), not a proofreader — the name must read as a companion. Shortlist: **Muse** (recommended, pairs with Voice), Scribe, Ghost, Margin. Internal folder stays `writing`; IPC namespace + nav follow the final name. — PENDING pick.
- **Comprehensive consumer settings** (built in `engine/settings.ts`): master on/off; language + translateTo; defaultTone/audience/formality/domain/customToneNote; surfaces (inApp/systemWide); per-app `appRules` (all/allowlist/denylist by bundle id); `pausedUntil` snooze; trigger/applyMode/showDiff; check toggles; `companion` (enabled/thinkingMode/useMemoryContext/createEntities); customDictionary; hotkey.
- **Tier:** FULLY PRO (settled). §6.
- **System-wide hotkey:** default **Cmd+Option+Space** (Voice is Option+Space — same family, learn as a pair); user-configurable in settings. (settled)
- **Voice link:** dictation inherits `WritingSettings` via a `WritingCleanupSink` (settled). Phase 3.5.

Still open:
1. **Engine home:** `packages/writing` in desktop now (recommended, lifts to shared later) vs. `shared/@offgrid/writing` immediately.
2. **POS tagger in v1?** Recommend ship without it (regex/word-list rules + LLM for grammar), add POS-dependent rules later.
3. **Confusion pairs (their/there):** LLM-only in v1 (recommended) vs. ship an n-gram table.

## 9. Suggested first slice (one PR)
Phase 0 (0.1–0.4, 0.7) + Phase 1.0–1.4 + Phase 2.1–2.2 minimal: engine with SymSpell + rule catalog, main IPC `writing:check`/`get-settings`, and `AssistedTextarea` showing live spelling/style squiggles with tap-to-fix in the chat composer — pro-gated (behind `proEnabled()`), no LLM yet. Smallest thing that visibly "feels like Grammarly" and proves the hardest UI piece. LLM rewrite (2.3) + system-wide (Phase 3) follow as separate PRs.
```
