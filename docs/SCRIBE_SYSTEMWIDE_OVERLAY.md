# Scribe system-wide inline overlay — implementation plan

Grammarly-style **inline squiggles in any app**, no hotkey, no browser extension. This doc is
the design for review before code. It builds on the working writing engine (see
`WRITING_ASSISTANT_PLAN.md`) and the dictation AX/paste infra.

## What we proved (AX probe, on-device, 2026-07-05)

`scripts/scribe-ax-probe/` measured, for the focused text field in the frontmost app,
whether macOS gives us a per-word bounding rectangle (the thing we need to draw a squiggle).

| App | Type | `AXBoundsForRange` (direct) | Selection trick | Verdict |
|---|---|---|---|---|
| Notes | native Cocoa | ✅ 12/12 | — | direct |
| iTerm2 | native | ✅ 12/12 | — | direct (neg. Y = 2nd monitor, normalizable) |
| Slack | Electron | ✗ 0/12 | ✅ 12/12 | selection trick + `AXManualAccessibility` |
| Brave | browser web field | ✗ 0/12 | ✅ 12/12 | selection trick |

**Conclusion: a single native overlay covers native + Electron + browser web fields.** No
browser extension. Canvas-rendered surfaces (Google Docs) are the expected gap → hotkey fallback.

Reference (Apache-2.0, build-our-own, do not vendor): `PhilipSchmid/textwarden`
(`Sources/Accessibility/TextMonitor.swift`, `Sources/Positioning/Strategies/ChromiumStrategy.swift`),
`Automattic/harper`.

## The three AX techniques (proven)

1. **Enable the AX tree.** Chromium/Electron keep accessibility off until they detect a screen
   reader.
   - Electron desktop (Slack/Teams/VSCode): `AXUIElementSetAttributeValue(app, "AXManualAccessibility", true)` — succeeds, no side effects.
   - Browsers (Chrome/Brave): reject that (`-25205`); they use `AXEnhancedUserInterface` (VoiceOver's switch, can disturb window positioning → set, use, restore). Note: in testing the selection trick returned real bounds even when both enables were rejected, i.e. the tree was already warm — **cold-start handling is an open item (below).**
2. **Measure bounds.** `AXBoundsForRange` returns garbage in Chromium. Instead: save cursor →
   `kAXSelectedTextRangeAttribute = range` → wait ~45 ms → read `AXSelectedTextMarkerRange` →
   `AXBoundsForTextMarkerRange` → poll ≤10× rejecting **stale** (unchanged vs last) and
   **whole-line** (width > 80% of field) rects → restore cursor. Native apps skip all this and
   use `AXBoundsForRange` directly.
3. **Apply a fix.** Set `kAXSelectedTextRangeAttribute` to the issue span, then either set
   `kAXSelectedTextAttribute` (where supported) or synthesize paste (reuse dictation's
   `text-injection` paste-back). Restore cursor.

## Architecture — mechanism (Swift) vs policy (our engine)

Clean split so no writing logic leaks into the native binary and the engine stays the single
source of truth:

```
┌ Swift AX overlay service (mechanism only, generic) ──────────────┐
│  - AXObserver: focus / value-changed / scroll / resize / move     │
│  - read focused text + element frame                              │
│  - measure bounds for REQUESTED ranges (direct → selection trick) │
│  - transparent, click-through NSWindow: draws squiggle underlines │
│  - hit-test hover/click on a squiggle → emit event                │
│  - apply replacement over a span (AX set / paste)                 │
│  ↕ JSON lines over stdio                                          │
└──────────────────────────────────────────────────────────────────┘
         ↑ text, focus, bounds, hover/click     ↓ issues (spans), fix
┌ Pro main (policy) ───────────────────────────────────────────────┐
│  - runs the PURE rules engine (instant) + LLM on demand           │
│  - maps text → issues; asks service to measure only ISSUE spans   │
│  - owns WritingSettings (per-app enable, pause, checks)           │
└──────────────────────────────────────────────────────────────────┘
         ↓ show correction card at (x,y)
┌ Pro renderer ────────────────────────────────────────────────────┐
│  - correction card = reuse existing IssuePopover (React)          │
│    in a small non-activating panel window positioned by coords    │
└──────────────────────────────────────────────────────────────────┘
```

**Why Swift draws the squiggles (not an Electron full-screen overlay):** a transparent
click-through Electron window floating over *other* apps is notoriously unreliable
(focus-stealing, multi-monitor, click-through-except-regions, repaint cost). TextWarden proves the
native NSWindow path works. Squiggles are cheap CoreGraphics lines. **The interactive correction
card** stays our React `IssuePopover` in a small on-demand panel (reuse + streaming rewrites),
shown only when a squiggle is engaged — one small window, not a full-screen overlay.

**Rejected alternatives:** (a) Electron full-screen click-through overlay — reliability risk above.
(b) Native Swift correction card — loses React reuse + streaming; only fall back to this if the
panel-window positioning proves unreliable over other apps.

## IPC contract (Swift ⟷ Electron, JSON lines over stdio)

Service → main:
- `{type:"focus", app, bundleId, role, elementFrame:{x,y,w,h}, hasText:bool}`
- `{type:"text", text, charCount, selection:{loc,len}}` (debounced on value-changed)
- `{type:"bounds", ranges:[{loc,len,rect:{x,y,w,h}|null}]}` (reply to measure)
- `{type:"hover", span:{loc,len}, at:{x,y}}` / `{type:"click", span, at}`
- `{type:"scroll"}` / `{type:"blur"}`

Main → service:
- `{cmd:"measure", ranges:[{loc,len}]}` — measure only issue spans (not every word)
- `{cmd:"draw", underlines:[{rect,color}]}` — repaint overlay
- `{cmd:"apply", span:{loc,len}, replacement}` — perform the edit
- `{cmd:"enable", bundleId}` / `{cmd:"clear"}`

## Coordinate mapping

AX rects: points (= DIP, so Retina is 1:1 with Electron), **top-left origin, global** across all
displays (hence iTerm's negative Y on a second monitor). For the Swift NSWindow overlay, convert to
Cocoa bottom-left: `cocoaY = totalScreenHeight - axY - axHeight`, choosing the `NSScreen` that
contains the rect. For the Electron card panel, `screen.getDisplayNearestPoint` + DIP coords map
directly. Unit-test the transform with fixtures (incl. negative-Y multi-monitor).

## Per-app strategy registry

`AppStrategy` keyed by bundle id (mirrors TextWarden's ContentParsers), each declaring:
enable-attr (`manual` | `enhanced` | `none`), bounds-method (`direct` | `selection`), index space
(`utf16` | `grapheme`), selection offset (newline handling), and `visualUnderlines: bool`
(off for terminals / unreliable apps → card-only). Defaults: native → direct; Chromium bundle
prefixes → selection. One place; the service and settings both read it.

## Cold-start AX enable (open item)

In testing the selection trick worked even when both enable attrs were rejected (tree already
warm). Unknown: a freshly-launched browser with cold AX. Plan: on first focus in a Chromium app,
attempt enable → poll `AXValue`/bounds for up to ~1.5 s before first measure; if still cold, show
the squiggles on the next value-changed tick. **Verify with the quit-and-relaunch probe run
before P2.**

## Open-core placement

- **Swift service = generic mechanism, no writing logic** → `scripts/scribe-overlay/` (core),
  built + staged to `resources/bin` by `release.yml`, exactly like `scripts/dictation-hotkey`.
  Carries only AX + rect drawing, so it leaks no pro source. (Open decision: if we'd rather keep
  even the binary out of core, move source to `pro/native/` + a pro CI build step.)
- **All policy is pro:** engine use, issue→underline mapping, correction card, settings, activation
  live in `pro/main/writing/overlay/` + `pro/renderer`. Gated by `proEnabled()`; `OFFGRID_PRO=0`
  disables. Degrades gracefully to the existing select-and-hotkey flow if the binary is absent.
- Entitlements/permissions: reuse dictation's Accessibility grant + `text-injection`.

## Phases

- **P1 — Native apps, direct bounds.** Swift service (focus observer + `AXBoundsForRange`) +
  NSWindow overlay drawing squiggles + coordinate transform. Prove pixel-accurate squiggles over
  **Notes/Mail**, correct on scroll/resize/window-move. Correction card panel shows + applies a fix.
  *Accept:* squiggles track the text in Notes through scroll/resize; apply-fix works.
- **P2 — Electron + browser, selection trick.** Add enable-attr + selection-based measurement
  (cached, typing-pause gated, whole-line/stale rejection) + per-app registry + cold-start handling.
  Prove **Slack + a browser web field**. *Accept:* squiggles in Slack/Brave, no cursor disruption
  while typing, ≥ the probe's hit rate.
- **P3 — Interactions + settings.** Hover card (reuse IssuePopover) with apply / add-to-dictionary,
  per-app enable + pause honored, learning-loop feedback wired. *Accept:* full loop in ≥3 apps
  across all three buckets; per-app toggle + pause respected.
- Canvas apps (Google Docs): documented hotkey fallback, not in scope.

## Performance

Measure only **issue** spans (few) not every word. Cache bounds by (text hash, element frame,
attributed-string hash); invalidate on value/scroll/resize. Selection measurement only during
typing pauses (~400 ms idle) to avoid cursor interference. AX messaging timeout ~1 s. Hard cap on
issues drawn (reuse engine's `maxIssues`).

## Testing

- **Pure/unit (vitest, no Electron):** coordinate transform (incl. negative-Y multi-monitor),
  per-app strategy selection, issue→underline mapping, whole-line/stale rejection predicate.
- **Swift unit:** range→bounds parsing, selection-trick state machine (mirror TextWarden's
  `SlackStrategyValidationTests`), cursor save/restore.
- **Manual matrix (can't be E2E'd):** Notes, Mail, Slack, Brave, VSCode — squiggle accuracy,
  scroll tracking, apply-fix, no-typing-disruption. Screenshots per app in the PR.

## Risks / open questions

1. Cold-start browser AX (verify with quit-relaunch probe). 2. Card panel positioning over other
apps (fallback: native card). 3. Per-app quirks are the real cost ("98% of effort is macOS
integration" — TextWarden). 4. `AXEnhancedUserInterface` window side effect on browsers (set →
use → restore; measure impact). 5. Selection-trick cursor flicker if a measure escapes the
typing-pause gate.
