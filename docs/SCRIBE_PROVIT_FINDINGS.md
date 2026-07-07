# Scribe overlay × provit — E2E findings & handoff

Notes from running provit's `NativeMacActor` against the Scribe system-wide overlay (2026-07-05/06).
For the provit maintainer/agent. Provit lives at `../provit`; the acceptance journey is
`../provit/journeys/scribe-overlay.json`, the actor `../provit/src/mac/nativeMacActor.ts`, design
`../provit/docs/NATIVE_MAC_ACTOR.md`.

## What worked
- **NativeMacActor primitives pass.** `session() → "native-mac"`, `windowSize()` returns points,
  full-screen `screenshot()` produces a real PNG. Permissions (Screen Recording + Accessibility on
  the terminal) were sufficient — the same-process CGEvent helper is covered by the terminal grant.
- **The vision loop ran** — the gateway brain (`https://ai.getoffgridai.co/v1`, `qwen3-vl-8b`) judged
  each `observe` step and returned structured pass/fail with a reason. The plumbing is sound.

## Why the run never went green (not a Scribe bug)
Every `observe` failed because the **captured frame showed the wrong app** — Gmail/Finder/iTerm
instead of TextEdit. Root cause: **foreground contention**. `NativeMacActor` captures the whole
screen, and other processes kept stealing the foreground mid-run:
1. The actor focuses `appTarget` **once** at `launchApp`, then never re-asserts it; focus drifts.
2. ~20 concurrent `web-todomvc` provit runs (separate session) repeatedly threw a Chromium window to
   the front. Full-screen capture has no defense against that.
3. My own screenshot automation + the user working in parallel also pulled focus.

So the failures are an environment/harness issue, not the overlay. (The overlay itself was verified
by hand: emerald/red squiggles land accurately, the hover card applies fixes, Rephrase works — see
`GAPS_BACKLOG.md` and the desktop commits.)

## Recommended provit changes (ranked)
1. **Re-assert `frontmost(appTarget)` before every capture**, not just at `launchApp`. Cheap, and it
   fixes the dominant failure mode. (Its own gotcha doc says "if a click lands in the wrong app,
   focus shifted — re-run"; make it proactive instead of a manual retry.)
2. **Serialize native-mac runs behind a foreground lock.** A `surface: "native-mac"` run needs
   exclusive display foreground — it must refuse/queue while any web/Electron automation is active
   on the same display. Better: capture the **target window by `windowID`** (`CGWindowListCreateImage`
   for that window) instead of the whole screen, so another app grabbing front doesn't corrupt the
   frame. That's the real fix; #1 is the quick one.
3. **Fix the journey copy.** `journeys/scribe-overlay.json` step-1 `expect` says "emerald wavy
   underlines under the misspelled words." The overlay now uses **brand color-coding**: red for
   correctness (spelling/grammar/punctuation), **emerald for suggestions** (style/clarity/tone).
   So spelling underlines are RED. Update the expectation to "red wavy underlines under the misspelled
   words; emerald under the passive-voice/style sentence."

## To reproduce a clean run
Quit other automations, then (from `../provit`):
```
PROVIT_VISION=gateway PROVIT_PROVIDER=gateway \
  PROVIT_ORACLE_URL="https://ai.getoffgridai.co/v1" PROVIT_ORACLE_KEY="<oglb_ key>" \
  PROVIT_ORACLE_MODEL="qwythos-9b" PROVIT_VISION_MODEL="qwen3-vl-8b" \
  PROVIT_MAC_TARGET="com.apple.TextEdit" \
  node --experimental-strip-types --experimental-sqlite \
  src/ios/visionReplay.ts journeys/scribe-overlay.json recordings/scribe
```
Setup first: run the desktop app (`OFFGRID_PRO=1`, overlay on) and `open -a TextEdit` a doc seeded
with `please recieve teh alot of wierd notes.` + a passive-voice line. Keep the machine's foreground
free for the duration (single-owner display).
