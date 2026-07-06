# Gaps backlog

Honest running list of gaps, regressions, and "not fully done" items. Each entry: what, why it
matters, where, and status. Close with evidence; don't hide gaps. (Convention from `CLAUDE.md`
multi-agent operating model.)

Status legend: **OPEN** · **IN PROGRESS** · **RESOLVED** (with evidence) · **DECISION NEEDED**

---

## Scribe (writing companion)

### Design-system compliance (audited against `../brand/DESIGN_PHILOSOPHY.md`, 2026-07-06)

- **G-1 · Hardcoded dark hex → broken in light mode** — RESOLVED for `ReviewPanel.tsx`; **OPEN**
  for `RewriteToolbar.tsx`, `LearnedStyle.tsx`, `StyleGuides.tsx`. These use inline `style={{}}`
  with dark-only hex (`#E5E5E5`, `#232323`, `#808080`…), so they wash out in light mode — the exact
  bug the user hit on the Scribe screen. Fix: convert to theme-aware Tailwind (`neutral-*`/`emerald`
  map to `--og-*` tokens). Philosophy rule #5 (tokens, not magic numbers).
  Evidence to close: screenshot each in light + dark.

- **G-2 · Color-coded issue categories** — DECISION NEEDED. Squiggles + review cards color-code by
  category (red spelling, blue style, amber punctuation, violet tone) in the overlay, `AssistedTextarea`,
  and `ReviewPanel`. Philosophy rule #3 says "do not color-code information; use position/size/weight,"
  and "emerald and only emerald." This is a deliberate Grammarly convention (at-a-glance error type)
  that conflicts with the brand. Options: (a) keep as an intentional, documented exception; (b) go
  monochrome + rely on the category label text; (c) single emerald underline for everything, category
  only in the card. Needs the user's call before changing.

- **G-3 · a11y on icon-only buttons** — OPEN. The card gear/×, settings gear, and disabled-apps
  remove (×) buttons need `aria-label`/`title`. Philosophy rule #8 (accessible by default).

- **G-4 · `prefers-reduced-motion` not honored** — OPEN. `active:scale-95` / `transition-all` on
  Scribe buttons + card slide should be suppressed under reduced-motion. Philosophy rule #7.

- **G-5 · Toggle uses `rounded-full`** — LOW / likely-accept. `WritingSettings` toggle is a pill.
  Anti-pattern list says avoid pill shapes, but a toggle switch is a conventional control, not a
  pill *button*. Flagging for awareness; probably keep.

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

- **G-9 · provit E2E never got a clean green run** — OPEN. NativeMacActor works; the acceptance
  journey (`journeys/scribe-overlay.json`) failed on foreground contention (other automations stealing
  front). Findings written for the provit agent: re-focus appTarget before each capture; serialize
  native-mac runs; fix step-1 "emerald" → red/violet copy.

### Verification debt (mine — built but not visually confirmed by me)

- **G-10 · New Scribe screen + busy card look** — OPEN. Redesign + compact busy card are typechecked
  and code-reviewed but I did not screenshot the final look. Evidence to close: light + dark screenshots.
