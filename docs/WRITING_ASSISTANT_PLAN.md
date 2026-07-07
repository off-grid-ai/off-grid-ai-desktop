# Off Grid Writing Assistant — how the OSS engines work + our own build

**Goal:** a local-first writing assistant good enough that people stop paying for Grammarly / ProWritingAid. Everything on-device. **We build our own engine** — the OSS projects below are *reference for technique only* (algorithms and patterns aren't copyrightable; this is the same posture dictation took with FluidVoice/Handy). No third-party grammar engine as a runtime dependency.

**Sequencing:** desktop first (this repo), mobile after sync. Hard constraint: the engine + rules are pure/portable so both apps share them — only text read/inject is per-platform.

---

## Part 1 — How the reference engines actually work (the techniques we're stealing)

Every rule-based checker runs the **same 4-stage pipeline**. This is what we reimplement:

```
segment (into sentences) → tokenize (into words/punct) → POS-tag (noun/verb/…) → run rule passes → Issue[] {span, replacements}
```

### 1a. Spelling — SymSpell (Symmetric Delete). *Build ourselves; algorithm is fully public.*
The fast, well-understood speller. Mechanism:
- **Precompute (once):** for every dictionary word, generate all strings reachable by *deletes only* up to edit-distance 2 (a 5-letter word → ~25 deletes, not millions of edits). Store `delete → [(word, frequency)]` in a hash map.
- **Lookup (per query):** generate the same deletes from the misspelled input, hash-lookup candidates, verify true **Damerau-Levenshtein** distance ≤ max, rank by **word frequency**. ~1M× faster than Norvig because inserts/replaces/transposes (expensive, alphabet-dependent) become deletes (cheap, symmetric on both sides).
- **Bonus:** `LookupCompound` (fix wrong/missing spaces via a bigram table + naive-Bayes split) and `WordSegmentation` (triangular-matrix DP, O(n)). We want at least basic SymSpell + a frequency-ranked word list.

### 1b. POS tagging — Brill / rule-based tagger. *Build a lightweight version.*
Harper ships `harper-brill` (a **Brill tagger**): assign each word its most-frequent tag from a lexicon, then apply an ordered list of transformation rules ("change NN→VB if previous word is 'to'"). LanguageTool uses a finite-state tagger + a disambiguator that rewrites ambiguous tags via rules. For v1 we can start with: lexicon lookup + suffix heuristics (`-ing`→VBG, `-ly`→RB) + a handful of Brill-style fixups. POS tags are what let grammar rules be precise instead of pure regex.

### 1c. Grammar & style rules — LanguageTool XML patterns + write-good/proselint. *Author our own rule set as data.*
This is the reusable heart. Two flavours, both just **pattern matchers over the token+POS stream**:
- **LanguageTool XML pattern rules** — match token sequences with: literal (`think`), regex (`think|say`), POS tag (`postag="VB"`), `inflected="yes"` (match all forms), `skip`, `min`/`max`, `<or>`/`<and>`. Each rule carries a message + suggested replacement. Thousands of these = LanguageTool's grammar coverage. We define our own compact rule DSL (JSON/TS), not their XML, and grow a curated set.
- **write-good / proselint style checks** — regex + word lists, no NLP needed. Each returns `{index, offset}` (span). The whole catalog is easy to reimplement:
  - *Passive voice* — regex for `to be` + past participle.
  - *Weasel words* — word list (`very, really, quite, several, various`).
  - *Adverbs* — `-ly` list, flag as weakeners.
  - *Wordy phrases / redundancies* — phrase→shorter map (`in order to`→`to`).
  - *Lexical illusions* — regex for repeated words (`the the`).
  - *Clichés* — phrase list.
  - *Sentence-start `so` / `there is/are`* — anchored regex.
  - proselint adds: dates, hyperbole, jargon, mixed metaphors, sexism, redundancy — each a small check.

### 1d. Confusion pairs (their/there, form/from) — n-gram context. *Optional; or defer to the LLM.*
LanguageTool keeps a `confusion_sets` list of easily-swapped words. For each occurrence it builds the surrounding n-grams (`is their last` vs `is there last`), looks up **Google Books n-gram frequencies**, and if the alternative is much more frequent in context, flags it. Reimplementing needs a compact frequency table (large) — so for v1 we let the **LLM** catch these instead, and only ship an n-gram table if we want them offline in the cheap layer.

### 1e. Markup awareness & rule schema — Vale. *Reference for design.*
Vale is markup-aware (lints prose, skips code/URLs) and defines rules in YAML by *type*: `existence` (flag words), `substitution` (X→Y), `occurrence` (count limits), `consistency` (pick one spelling), `sequence` (ordered tokens). Good model for **our rule schema** and for not underlining inside code blocks.

### 1f. Dictionaries — morfologik/Hunspell (FSA + affix). *Simplify.*
LanguageTool/Hunspell compress dictionaries as finite-state automata + affix rules (stem + suffix rules → all inflections without listing them). We can start with a plain frequency-ranked word list in the SymSpell index and add affix compression only if size demands.

### 1g. LLM rewriting/tone — CoEdIT. *We already own the model; reuse the prompting pattern.*
Grammarly's own CoEdIT research: frame **all** editing as instruction-following — `Fix grammar: …`, `Make this more formal: …`, `Paraphrase: …`, `Simplify: …`, `Make this concise: …` — trained on 82K instructions, **60× smaller than general LLMs at equal quality**, and handles *composite* instructions ("make it formal and concise"). Takeaway: a small local model + clear instruction prompts is the right tool for tone/rewrite/translate — no rule engine can do this. This validates using our bundled model for Layer 2.

---

## Part 2 — Our architecture: two layers we build ourselves

| Layer | We build | Runs | Cadence | Job |
|---|---|---|---|---|
| **1. Rule engine** (own, from §1a–1f) | tokenizer + light POS tagger + SymSpell speller + data-driven rule set | pure TS in-process (desktop main/renderer; mobile JS) | **real-time per keystroke**, ms | spelling, punctuation, style, wordiness → underline spans + quick-fixes |
| **2. LLM editor** (own, §1g) | instruction prompts + JSON span schema | llama-server (desktop) / llama.rn (mobile) | **on-demand** | grammar correction, tone shift, rephrase, translate, full-doc report |

Both emit the **same `Issue` contract** so the UI never knows the source:
```ts
interface Issue {
  span: [start: number, end: number];
  category: 'spelling'|'grammar'|'punctuation'|'style'|'clarity'|'tone'|'word-choice';
  severity: 'error'|'warning'|'suggestion';
  message: string;
  replacements: string[];       // best-first; may be empty (advisory)
  source: 'rules'|'llm';
  ruleId?: string;
}
```

**Realistic v1 division of labour:** the rule engine is cheap and easy for spelling (SymSpell) + the write-good/proselint-style catalog. A full LanguageTool-scale grammar library is huge, so v1 leans on the **LLM for heavy grammar/GEC** and the rule engine for the instant, high-precision, offline-cheap checks. We grow our own rule DSL over time. This is honest about effort: we're not rebuilding 5,000 LanguageTool rules on day one.

### Portability (the "must work on mobile" constraint)
Engine + rules live in a shared, dependency-free module (candidate: `@offgrid/writing` in the shared monorepo). It imports neither Electron nor React Native. The LLM call is an injected `CompletionClient` interface — desktop plugs the `127.0.0.1:7878` gateway, mobile plugs `llama.rn`. New platform = one adapter, zero engine changes.

---

## Part 3 — Desktop surfaces (mostly wiring existing dictation seams)

Dictation already built the system-wide plumbing:

| Need | Status | Where |
|---|---|---|
| Read focused-app text (`AXSelectedText`, `AXValue`) | **EXISTS** | `electron/accessibility/main.swift` |
| Replace text in focused app (clipboard preserve→paste→restore) | **EXISTS** | `pro/main/text-injection.ts` `pasteIntoApp()` |
| Global hotkey (Swift CGEventTap) | **EXISTS** | `scripts/dictation-hotkey/main.swift` |
| Non-focus-stealing overlay (NSPanel, floats over fullscreen) | **EXISTS** | `pro/main/dictation/overlay.ts` |
| Accessibility permission + entitlements | **EXISTS** | `src/main/permissions.ts`, `build/entitlements.mac.plist` |
| LLM structured JSON + streaming | **EXISTS** | `src/main/model-server.ts` (`callLlamaJson`, `proxyToLlama`) |
| Settings section registry | **EXISTS** | `src/renderer/src/bootstrap/sectionRegistry.ts`, `pro/renderer/settings.ts` |
| **Our rule engine + LLM editor** | net-new | new shared module |
| Suggestions overlay UI, in-app inline underlines, range-replace | net-new | renderer + small `text-injection` extension |

Two desktop modes, one engine:
1. **In-app** (chat composer, notes): live rule-engine underlines; select → LLM tone/rewrite.
2. **System-wide** (headline): hotkey → read via `main.swift` → engine → suggestions NSPanel → apply via `pasteIntoApp`. "Grammarly in every macOS app," reusing dictation infra. Net-new native is small: on-hotkey field pull (vs today's 2s poll) + range replace.

---

## Part 4 — Mobile surfaces (after sync)

Same engine core; only adapters differ (llama.rn already shipped).
- **M1 in-app editor** — rule engine is pure TS (runs in Hermes directly, no WASM needed since it's *our* code, not Harper's WASM); LLM via llama.rn. Ships easily.
- **M2 share-sheet extension** — select text anywhere → Off Grid → check/rewrite.
- **M3 keyboard** — Android `InputMethodService` first (capable), iOS keyboard last (sandboxed, needs Full Access).

Note: building the rule engine in plain TS (not adopting Harper's Rust/WASM) is what makes mobile trivial — no Hermes-WASM problem.

---

## Part 5 — Settings (where shown / how to rewrite / tone / language)

Single schema in the shared module, surfaced via each app's section registry:
```ts
interface WritingSettings {
  surfaces: { inApp: boolean; systemWide: boolean };     // + mobile: shareSheet, keyboard
  trigger: 'realtime'|'on-pause'|'manual';
  hotkey: string;
  checks: { spelling; grammar; punctuation; style; clarity; toneConsistency: boolean };
  applyMode: 'suggest'|'autofix';
  showDiff: boolean;
  tone: 'neutral'|'professional'|'friendly'|'confident'|'concise'|'academic';
  customToneNote?: string;
  audience: 'general'|'knowledgeable'|'expert';
  formality: 'informal'|'neutral'|'formal';
  domain: 'general'|'email'|'academic'|'creative'|'technical'|'casual';
  checkLanguage: string;      // rule-engine dialect (en-US/en-GB)
  translateTo?: string;
  customDictionary: string[]; // never-flag words (feeds SymSpell + rules)
}
```

---

## Part 6 — Parity & differentiator

Match: real-time spelling/grammar/punctuation (rules), clarity/conciseness/passive (rules+LLM), tone detect+shift (LLM), rephrase/shorten/expand (LLM), goals steering (settings→prompt), synonyms (thesaurus list + LLM), custom dictionary (rules), full-document report (LLM batch — go deeper than Grammarly free).

Skip honestly: **plagiarism** (needs cloud corpus — incompatible with local-first; we don't fake it); broad multilingual *grammar rules* (English-first rules; LLM covers other languages).

Wedge: **same corrections, none of it leaves your Mac** — offline, no account, no upload. Mechanism claim, not a values claim.

---

## Part 6.5 — Ecosystem integration (the real differentiator)

The assistant is NOT a standalone grammar tool. It reads from and writes to the **same shared store** the rest of Off Grid uses (one SQLite `memories.db` + LanceDB) — so it's context-aware and it learns. No parallel store, no sync headaches. All seams already exist:

**READ — makes suggestions smarter (context in):**
- **Entities as a never-flag dictionary** — `findEntityIdByName` / `findEntityIdByNameFuzzy` / `findByAlias` (`pro/main/crm/resolve.ts`). Known people/companies/products ("Acme", "Priya", product names) are validated as real, never flagged as typos. This is our custom dictionary — already populated by everything the user does.
- **Past writing + domain terms** — `ragService.searchProject(projectId, text, {topK})` (`src/main/rag/index.ts`, LanceDB MiniLM). Pulls how the user usually writes and their domain vocabulary to steer a rewrite toward *their* voice, not generic prose.
- **Learned style preferences** — `getPreferenceDoc()` (`pro/main/crm/preferences.ts`), the curated ~1800-char doc injected into proposer prompts. Feeds the rewrite prompt so tone matches what the user has accepted before (e.g. "never casual for contracts").
- **Screen/observation context** — `getObservationFrames` / `getDayActivity` (`pro/main/crm/day.ts`). What the user is looking at / recently did → the assistant knows the *subject* you're writing about, so a rewrite can reference the right context.

**WRITE — makes it better over time (learning out):**
- **Record accepted edits as observations** — `recordObservation({summary, surface:'WritingAssistant', mentions, frames})` (`pro/main/crm/observations.ts`, the same governed pipeline dictation uses). Accepted rewrites feed the entity/action/Reflect pipeline. Don't fork the pipeline — reuse it (per [[fleet-control-strategy]] / [[dictation-feature]]).
- **Teach vocabulary** — `addAlias(entityId, 'name', variant)` when the user adds a term or corrects a flag → persists as user-sourced, never flagged again.
- **Feedback loop** — `recordFeedback({title, reason, kind})` on accept/reject → the hourly `distillPreferences()` folds it into durable style rules that then flow back into the READ path above. Accept/reject literally trains the assistant's future tone.

Net effect for the user: the longer they use Off Grid, the more the writing assistant sounds like *them* and knows *their* world — because it's fed by the same brain as capture, memory, and the CRM. That closed loop is the thing Grammarly can't build: it doesn't have your entities, your screen context, or your local memory.

Mobile parity: mobile has the same primitives (op-sqlite + on-device MiniLM embeddings + the knowledge base). The read/write API is defined once in the shared engine over an injected store interface; each app supplies its own store adapter (desktop SQLite/LanceDB, mobile op-sqlite) — same pattern as the injected `CompletionClient`.

## Part 7 — Open-core split (recommended)
- **Free:** our rule engine (spelling/punctuation/style), in-app. The hook off Grammarly free.
- **Pro:** LLM layer (grammar/GEC, tone, rewrite, translate, report) + system-wide. All on-device.
- Placement: engine → shared module; desktop pro integration (overlay/hotkey/LLM actions/settings section) → `pro/`; core carries the inert shell + the free rule path.

---

## Part 8 — Build phases
- **P0** shared engine module: tokenizer, light POS tagger, SymSpell speller + word/frequency list, rule DSL + starter rule catalog (write-good/proselint set), `Issue` contract, LLM editor with injected `CompletionClient`, prompt templates + JSON schema, settings schema. Pure, unit-tested, no app deps.
- **P1** desktop in-app: live underlines in chat/notes; selection→LLM tone/rewrite; settings section.
- **P2** desktop system-wide: hotkey → AX read → engine → NSPanel → apply.
- **P3** full-document report (LLM batch).
- **P4+** mobile: in-app → share ext → Android keyboard → iOS keyboard.

Each phase ships with tests (pure logic unit-tested; rule catalog + prompt contracts regression-guarded; E2E asserting surfaces render) and PR evidence per CLAUDE.md.

---

## Part 9 — Decisions to lock before P0
1. **Free/pro line** — confirm §7.
2. **How much rule engine vs LLM in v1** — recommend: SymSpell speller + proselint/write-good style catalog in rules; grammar/GEC to the LLM initially; grow the rule DSL over time.
3. **Confusion pairs offline?** — ship an n-gram table (big) or let the LLM handle their/there for v1 (recommended).
4. **System-wide UX** — hotkey-on-selection first (like dictation); defer always-on background field scanning (battery/privacy).

## Sources (reference-only, technique)
- Harper (Automattic) — Rust, `harper-brill` Brill tagger, `harper-tree-sitter`, dictionary/thesaurus modules: github.com/Automattic/harper
- LanguageTool pipeline + XML pattern rules: dev.languagetool.org/development-overview
- LanguageTool n-gram confusion detection: dev.languagetool.org/finding-errors-using-n-gram-data
- SymSpell (Symmetric Delete): github.com/wolfgarbe/SymSpell
- write-good checks: github.com/btford/write-good ; proselint (similar) ; Vale rule schema: vale.sh
- CoEdIT instruction-tuned editing: arxiv.org/abs/2305.09857
</content>
