# Gaps backlog

Honest running list of gaps, regressions, and "not fully done" items. Each entry: what, why it
matters, where, and status. Close with evidence; don't hide gaps. (Convention from `CLAUDE.md`
multi-agent operating model.)

Status legend: **OPEN** · **IN PROGRESS** · **RESOLVED** (with evidence) · **DECISION NEEDED**

---

## Scribe (writing companion)

### Design-system compliance (audited against `../brand/DESIGN_PHILOSOPHY.md`, 2026-07-06)

- **G-1 · Hardcoded dark hex → broken in light mode** — RESOLVED. All four hex-hardcoded components
  converted to theme-aware Tailwind (`neutral-*`/`emerald` → `--og-*` tokens): `ReviewPanel.tsx`,
  `RewriteToolbar.tsx`, `LearnedStyle.tsx`, `StyleGuides.tsx`. typecheck clean, 554 tests pass.
  Remaining inline hex is only in `AssistedTextarea.tsx` (squiggle overlay positioning + the
  category hues, which is the G-2 decision) — not a light/dark bug. Evidence still owed: light-mode
  screenshots of the settings panel + rewrite toolbar (folded into G-10).

- **G-2 · Color-coded issue categories** — RESOLVED (user decision: brand-align). Dropped the
  rainbow for the two brand colors: **semantic error red** for correctness (spelling/grammar/
  punctuation) and **emerald** for suggestions (style/clarity/tone/word-choice). Applied in all three
  places: overlay binary `CATEGORY_COLOR`, `AssistedTextarea` `UNDERLINE`, `ReviewPanel`
  `CATEGORY_COLOR`.

- **G-3 · a11y on icon-only buttons** — RESOLVED (DOM buttons). Added `aria-label` (+`title`) to the
  settings-close X and the disabled-apps remove X. The overlay card's gear/× are native AppKit chips
  (Swift `NSView`), not DOM — out of scope for web a11y; AppKit handles their accessibility.

- **G-4 · `prefers-reduced-motion` not honored** — RESOLVED. Added the standard global rule in
  `src/renderer/src/assets/main.css` collapsing all transitions/animations to ~instant under
  reduced-motion (was only disabling the shooting-star). App-wide, not just Scribe.

- **G-5 · Toggle uses `rounded-full`** — LOW / likely-accept. `WritingSettings` toggle is a pill.
  Anti-pattern list says avoid pill shapes, but a toggle switch is a conventional control, not a
  pill *button*. Flagging for awareness; probably keep.

### Spelling false-positives (proactive audit, 2026-07-06 — the class the user keeps hitting)

- **G-11 · Contractions flagged** — RESOLVED. `I'll`, `I've`, `don't`, `it's`, `o'clock` were
  flagged (tokenize as one non-dictionary word). `isContraction()` accepts known head + standard
  clitic. Tested. (User-reported.)
- **G-12 · URLs / emails / @mentions / #tags / `code` flagged** — RESOLVED. Their letter-runs
  (getoffgridai, wednesday, handles) flooded chat/email with red squiggles. `protectedRanges()`
  skips any token inside such a span. Benefits the overlay too (same engine). Tested.
- **G-13 · Hyphenated compounds flagged** — RESOLVED. `well-known`, `on-device`, `end-to-end`
  accepted when every part is a valid word. Tested.

### Functional (from on-device testing, 2026-07-06)

- **G-6 · Slack live squiggles — not visually confirmed** — OPEN. Root cause fixed + PROVEN: the
  overlay now sees Slack's field (`[scribe-overlay] focused Slack (com.tinyspeck.slackmacgap)` in
  the log) after enabling `AXManualAccessibility` per app. NOT yet confirmed visually that squiggles
  draw on misspelled Slack text after the ~1.2s typing-pause (blind automation kept hitting the wrong
  window; risk of sending a real message). Evidence to close: user types a misspelling in Slack,
  pauses, sees a squiggle; or a controlled capture.

- **G-7 · Live-underline pause behavior needs real-use tuning** — OPEN. In Chromium/Electron the
  selection-trick moves the caret, so measurement is gated to ≥1.2s idle + collapsed caret. The
  threshold is a guess; confirm it feels right (not too laggy, no cursor flicker) in real typing and
  tune `selectionIdle`.

- **G-8 · No live squiggles while actively typing in Slack/browser** — BY DESIGN, documented. Only
  native Cocoa apps get truly-live underlines (non-invasive bounds). Revisit if a non-invasive
  per-range bounds method is found (AX text markers returned whole-element bounds in testing).

- **G-9 · provit E2E never got a clean green run** — OPEN (findings written up, handed off).
  NativeMacActor works; the acceptance journey failed on foreground contention (other automations
  stealing front), not a Scribe bug. Full writeup + ranked provit fixes + repro steps in
  **`SCRIBE_PROVIT_FINDINGS.md`**. Ball is in the provit agent's court (re-focus appTarget per
  capture; capture-by-windowID / serialize native-mac runs; fix the journey's red-vs-emerald copy).

### Verification debt (mine — built but not visually confirmed by me)

- **G-10 · New Scribe screen + busy card look** — OPEN. Redesign + compact busy card are typechecked
  and code-reviewed but I did not screenshot the final look. Evidence to close: light + dark screenshots.

## Editor & rich text (2026-07-07)

- **G-14 · Markdown preview looked unstyled** — RESOLVED. It rendered but Tailwind Preflight strips
  heading/bold/list styles; added scoped `.scribe-preview` prose CSS.
- **G-15 · Real rich-text mode (TipTap)** — DONE (needs on-device visual check). Rich text is now a
  single WYSIWYG (TipTap/ProseMirror), no preview split; live squiggles as PM decorations, click-to-
  fix; own toolbar. Compiles + production-bundles. NOT visually verified by me.
- **G-16 · Rich-mode side-panel "apply fix" is inert** — OPEN (minor). The Review panel's one-click
  apply (onApply) edits plain text; in rich mode the doc is HTML, so applying from the side panel
  won't reflect. Rich mode has its own inline click-to-fix instead. Wire the review panel's apply to
  the TipTap doc later, or hide per-issue apply buttons in rich mode.
- **G-17 · Rich-mode squiggle hover card** — OPEN. Rich mode applies the first fix on click; it does
  not yet show the full hover card (choose among suggestions / add-to-dictionary / rephrase) that the
  plain-text modes have. Add a ProseMirror hover tooltip later.
