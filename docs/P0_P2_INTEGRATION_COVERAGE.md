# P0-P2 integration coverage

Living status for the 155 release journeys in
[`RELEASE_TEST_CHECKLIST.csv`](RELEASE_TEST_CHECKLIST.csv). This file is intentionally
conservative: a unit test, source-reading assertion, rendered shell without the real behavior, or
manual claim does not count as complete integration coverage.

## Current status - 2026-07-17

- Status snapshot:
  - P0: 74 total, 25 covered, 49 left.
  - P1: 71 total, 7 covered, 64 left.
  - P2: 10 total, 1 covered, 9 left.
  - Overall: 155 total, 33 covered, 122 left.
- Green gates today:
  - `npm test`: 203 files passed, 1 skipped; 2,192 tests passed, 1 skipped.
  - `npm run test:coverage`: 96.75% statements, 91.55% branches, 96.15% functions,
    97.52% lines.
  - `npm run test:db`: 13 files and 105 real SQLite integration tests passed; Electron ABI
    restored afterward.
  - `npm run test:e2e`: 28 Playwright Electron tests passed against fresh synthetic temp profiles.
  - Both TypeScript projects pass.
- Not yet a clean handoff: release-journey coverage remains incomplete, and strict ESLint exposes
  a legacy backlog. Neither is hidden by the coverage percentage.

## Covered P0 journeys

- #3 - Fresh profile is truly fresh. `e2e/smoke.spec.ts` launches the built Electron app with a
  new temp `OFFGRID_USER_DATA` directory and verifies first-run onboarding and the preload bridge.
- #9 - Fresh onboarding completes. `e2e/smoke.spec.ts` drives the real onboarding flow and lands on
  Models.
- #13 - System Health is truthful. `e2e/smoke.spec.ts` launches a fresh profile, compares the real
  gateway `/health` payload with the System Health IPC components, verifies absent runtimes are
  reported as `not_installed`, and confirms the unavailable chat engine port is actually down.
- #43 - Chat survives relaunch. `e2e/chat-memory.spec.ts` creates multiple scoped and unscoped
  conversations with messages and context through production IPC, fully closes Electron, reopens
  the same profile, and verifies every association and payload through the reloaded preload path.
- #51 - Create a project. `src/main/__tests__/rag-store-integration.dbtest.ts` exercises the real
  project store against temp SQLite and verifies the round trip.
- #56 - Delete project cascades. `src/main/__tests__/project-delete-cascade.dbtest.ts` uses the real
  project, conversation, message, artifact, document, and chunk paths and proves no orphans remain.
- #63 - Image cancellation keeps text. `MemoryChat.tool-image-cancel.test.tsx` drives the real
  rendered MemoryChat path with the image engine as the external boundary and verifies the text
  turn persists.
- #79 - Gateway models endpoint. `e2e/smoke.spec.ts` starts the real Electron gateway, seeds an
  active model only inside the disposable profile, calls `/v1/models` over HTTP, and verifies
  modality metadata in both supported response shapes.
- #87 - Replay timeline renders. `e2e/pro.spec.ts` launches the real Pro build path with synthetic
  data and verifies Replay renders instead of the upgrade screen.
- #94 - Delete all removes capture corpus. `pro/main/__tests__/personal-data.integration.test.ts`
  registers the real Pro personal-data owner, runs the real delete-all path, and verifies the
  observations corpus is gone.
- #100 - Dictation pastes at cursor. `paste-at-cursor.test.ts` exercises the real dictation sink
  with only the OS automation boundary faked, including ordering and clipboard restoration.
- #112 - Approval queue gates actions. `approvals.integration.test.ts` exercises real proposal,
  decision, execution, failure, and audit persistence against SQLite.
- #117 - Clipboard records text. `e2e/pro.spec.ts` writes unique text to the real OS clipboard and
  waits for the production poller and encrypted history store to expose that exact item over IPC.
- #119 - Clipboard records images and files. `e2e/pro.spec.ts` captures real file URLs and a new
  pixel bitmap, then restores the bitmap bytes and verifies their exact dimensions.
- #121 - Clipboard restore text. The same E2E journey overwrites the OS clipboard after capture,
  restores the stored item through production IPC, and verifies the original text returns.
- #122 - Clipboard restore file. `e2e/pro.spec.ts` drives the real capture-to-restore path and
  verifies macOS receives path text, file URL, and native bytes, including an image-file case.
- #125 - Create and unlock vault. `vault-service.test.ts` uses real KDBX4, Argon2id, WASM crypto,
  and a real temp directory; correct and incorrect passwords are covered.
- #126 - Vault item types round-trip. `vault-service.test.ts` covers real encrypted CRUD and binary
  attachment persistence across lock and unlock.
- #127 - Vault copy actions. `e2e/pro.spec.ts` creates a real encrypted KDBX entry through
  production IPC and verifies username, revealed password, and URL copy into the OS clipboard.
- #128 - Vault recovery and backup. `vault-service.test.ts` and `vault-recovery.test.ts` exercise
  real KDBX export bytes, recovery setup, wrong phrases, and recovery to a new password.
- #130 - Chat residency stays required. `e2e/settings-residency.spec.ts` verifies the production
  switch stays checked and disabled before and after relaunch, while the real SQLite integration
  proves an on-demand write is normalized back to `resident`.
- #135 - Delete category is scoped. The real SQLite/filesystem integration deletes the Chats
  category through `clearCategory` and proves memory, projects, connectors, encrypted tokens,
  models, and unrelated personal files remain.
- #136 - Delete all is complete. Core and Pro DB integration tests seed projects, chats, memory,
  knowledge, connectors, encrypted tokens, profile data, every registered Pro table, and every
  personal-data directory. They run the real delete-all registry, close and reopen the encrypted
  database, and verify personal data stays gone while models and ordinary preferences survive.
- #137 - Core locked Pro tabs. The free-tier Electron tour discovers every lock-bearing nav item
  rendered from the production catalog, opens each one, verifies its matching upgrade heading, and
  confirms the Pro entitlement remains false.
- #145 - Cold relaunch after forced quit. `e2e/chat-memory.spec.ts` kills the real Electron main
  process during non-destructive chat activity, waits for process exit, reopens the same profile,
  and verifies clean boot, preload availability, usable input, and durable committed chat data.

## Covered P1 journeys

- #45 - Delete conversation cascades. `conversation-delete-cascade.dbtest.ts` proves real messages
  and artifacts do not survive conversation deletion.
- #110 - Entity merge preserves evidence. `resolve.integration.test.ts` exercises real entity,
  aliases, observations, relationships, action reassignment, split, and merge persistence.
- #113 - Action status survives persistence. `actions-status.integration.test.ts` exercises real
  status, reopen, dismiss, feedback, ordering, and reason storage against SQLite.
- #115 - Reflect uses real time ranges. `reflect.integration.test.ts` verifies real observation
  windows, dwell caps, category rollups, context switches, and seven-day aggregation.
- #118 - Clipboard deduplicates repeated copy. `clipboard-store.integration.test.ts` exercises the
  real store and proves timestamp bump-to-top without duplicate rows or lost tags.
- #120 - Clipboard live refresh keeps valid selection.
  `ClipboardScreen.integration.test.tsx` renders the real screen and proves selection is retained
  while the item exists, then moves to a valid remaining item after deletion.
- #129 - Runtime residency toggles persist. `e2e/settings-residency.spec.ts` changes image, STT,
  and TTS through the real Settings controls, verifies production IPC, fully relaunches Electron,
  and verifies all values reload. The SQLite and runtime-manager integrations prove that same map
  controls persistence and re-warm behavior.

## Covered P2 journeys

- #124 - Clipboard retention applies. `clipboard-store.integration.test.ts` exercises the real
  retention-days and max-items policies against SQLite while preserving newer rows.

## Left - package and install

- #1 - Core DMG installs cleanly.
- #2 - Pro DMG installs cleanly.
- #4 - Core and Pro artifact separation.
- #5 - Packaged helper binaries exist.
- #6 - Packaged llama dependency closure.
- #7 - Upgrade preserves user data.
- #8 - Window identity and product name.

## Left - onboarding and health

- #10 - Configure for me completes.
- #11 - Manual setup path works.
- #12 - Onboarding resumes after relaunch.
- #14 - Chat engine stderr is surfaced.
- #15 - Required permissions granted.
- #16 - Denied permission is recoverable.

## Left - models and downloads

- #17 - Text model downloads.
- #18 - Vision model downloads.
- #19 - Speech model downloads.
- #20 - TTS model downloads.
- #21 - Image model downloads.
- #22 - Multiple downloads queue.
- #23 - Delete does not cancel another download.
- #24 - Offline download fails clearly.
- #25 - Interrupted download recovers.
- #26 - Truncated GGUF is rejected.
- #27 - Disk write failure does not crash.
- #28 - Active text model survives relaunch.
- #29 - Active modal models survive relaunch.
- #30 - Deleting active model clears selection.
- #31 - Models use desktop density.

## Left - chat and conversations

- #32 - First local message replies.
- #33 - No memory scope works.
- #34 - All memory scope works.
- #35 - Empty memory degrades safely.
- #36 - Thinking streams separately.
- #37 - Plain reply hides think markers.
- #38 - Stop before first token.
- #39 - Stop during streaming.
- #40 - Queued message order.
- #41 - Conversation switch isolation.
- #42 - Project switch isolation.
- #44 - Rename conversation.
- #46 - Copy assistant reply.
- #47 - Regenerate reply.
- #48 - Error clears busy state.
- #49 - Long answer respects configured cap.
- #50 - Keyboard and navigation shortcuts.

## Left - projects and artifacts

- #52 - Attach a knowledge document.
- #53 - Project retrieval is grounded.
- #54 - New chat inherits project.
- #55 - Edit project.
- #57 - Text artifact saves and reopens.
- #58 - Image artifact saves and reopens.
- #59 - Project list uses desktop layout.
- #60 - Unsupported document fails clearly.

## Left - image and vision

- #61 - Text prompt generates an image.
- #62 - Image cancellation is scoped.
- #64 - Image settings apply.
- #65 - Image runtime eviction recovers.
- #66 - Image RAM guard is safe.
- #67 - Generated image opens.
- #68 - Vision answers about attachment.
- #69 - Text-only model guards image input.
- #70 - Damaged image fails safely.

## Left - integrations and gateway

- #71 - Connector can be added.
- #72 - Connector tools load.
- #73 - Connector tool executes.
- #74 - Write tool requires approval.
- #75 - Stop prevents connector side effect.
- #76 - Expired connector becomes error.
- #77 - Dead connector does not hang all tools.
- #78 - Connector delete removes secrets.
- #80 - Gateway chat streaming.
- #81 - Gateway image route.
- #82 - Gateway failure envelope.

## Left - capture, memory, and replay

- #83 - Screen capture permission path.
- #84 - Capture disabled means no capture.
- #85 - OCR creates searchable memory.
- #86 - Sensitive or excluded apps are omitted.
- #88 - Replay playback uses media server.
- #89 - Replay navigation preserves target.
- #90 - Unified search finds each source.
- #91 - Search filters and sort apply.
- #92 - Day briefing renders.
- #93 - Day links open correct records.

## Left - meetings, voice, and dictation

- #95 - Meeting detection is truthful.
- #96 - Manual meeting recording.
- #97 - Meeting transcript and summary.
- #98 - Meeting survives relaunch.
- #99 - Global dictation hotkey.
- #101 - Dictation paste failure is visible.
- #102 - Dictation engine selection.
- #103 - Import media for transcription.
- #104 - Voice retention settings apply.
- #105 - Speak assistant reply.
- #106 - Mic and TTS stop cleanly.

## Left - entities, actions, and reflection

- #107 - Entities are synthesized.
- #108 - Self mentions are filtered.
- #109 - Entity detail opens.
- #111 - Action items are extracted.
- #114 - Notifications open their target.
- #116 - CRM processing tolerates schema upgrades.

## Left - clipboard and vault

- #123 - Clipboard popup hotkey.

## Left - settings, privacy, licensing, and updates

- #131 - Resource mode applies.
- #132 - Settings survive relaunch.
- #133 - Storage usage is truthful.
- #134 - Clear cache preserves user data.
- #138 - Pro license activates.
- #139 - Invalid or exhausted license fails clearly.
- #140 - Offline entitlement behavior.
- #141 - Core and Pro override behavior.
- #142 - Manual update check.
- #143 - Update channel persists.

## Left - resilience and desktop polish

- #144 - Local use works offline.
- #146 - Model ports are single-owner.
- #147 - Engine restart recovers.
- #148 - Low disk space is handled.
- #149 - Large seeded collections stay usable.
- #150 - Window resize preserves desktop layout.
- #151 - Keyboard focus is visible.
- #152 - Escape closes transient UI.
- #153 - Reduced motion remains usable.
- #154 - External links use the system browser.
- #155 - No private data in release evidence.

## Next implementation order

- P0 deterministic integration gaps first: chat streaming/cancellation/isolation, project document
  grounding, connector approval and cancellation, capture-to-OCR-to-memory, meeting recording and
  transcription, clipboard text restore, privacy deletion completeness, and settings persistence.
- P0 boundary rigs next: model download interruption/disk failure, offline local use, engine restart,
  low disk, packaged artifact closure, upgrade preservation, and licensing cache behavior.
- P1 and P2 after their owning P0 seams are green, reusing the same real harnesses rather than
  adding parallel mocks.
- Manual-only packaged, TCC, global-hotkey, cross-app paste, resize, accessibility, and release
  evidence checks remain explicit release blockers until their automation or signed manual evidence
  exists.
