# P0-P2 integration coverage

Living status for the 155 release journeys in
[`RELEASE_TEST_CHECKLIST.csv`](RELEASE_TEST_CHECKLIST.csv). This file is intentionally
conservative: a unit test, source-reading assertion, rendered shell without the real behavior, or
manual claim does not count as complete integration coverage.

## Current status - 2026-07-17

- Status snapshot:
  - P0: 74 total, 57 covered, 17 left.
  - P1: 71 total, 48 covered, 23 left.
  - P2: 10 total, 3 covered, 7 left.
  - Overall: 155 total, 108 covered, 47 left.
- Green gates today:
  - `npm run test:coverage`: 209 files passed, 1 skipped; 2,223 tests passed, 1 skipped;
    96.80% statements, 91.64% branches, 96.19% functions, and 97.54% lines.
  - `npm run test:db`: 17 files and 112 real SQLite integration tests passed; Electron ABI
    restored afterward.
  - `npm run test:e2e`: 28 Playwright Electron tests passed against fresh synthetic temp profiles.
  - Core main, renderer, and Pro TypeScript projects pass.
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
- #17 - Text model downloads. `model-download-matrix.integration.test.ts` streams deterministic
  GGUF bytes through the production manager's HTTP boundary, verifies observable progress and
  atomic promotion, then activates the installed catalog model through the real selection owner.
- #25 - Interrupted download recovers. `model-integrity.integration.test.ts` interrupts a real
  streamed partial, reloads the manager, resumes with the correct HTTP range, verifies exact final
  bytes and installation, then reloads again to prove completed state stays cleared.
- #26 - Truncated GGUF is rejected. `model-integrity.integration.test.ts` drives the real model
  manager against a temp filesystem, with only HTTP delivery faked, and proves truncated downloads
  and local imports are rejected before promotion, installation, copying, or registration.
- #27 - Disk write failure does not crash. The same real model-manager integration injects
  `ENOSPC` only at the OS write boundary and proves the error is contained, no partial model is
  installed, failed status is recorded, and an existing installed model remains readable.
- #28 - Active text model survives relaunch. `model-integrity.integration.test.ts` installs and
  activates a real catalog text fixture through the production model manager, reloads every module,
  and proves the same installed model remains the active chat selection.
- #32 - First local message replies. `MemoryChat.chat-lifecycle.test.tsx` sends through the real
  rendered composer, routes a streamed token through production ownership, resolves the local-model
  boundary, and proves one assistant bubble with the exact answer is persisted once.
- #33 - No memory scope works. The same rendered integration keeps No memory visibly selected,
  sends a turn through the production chat path with retrieval disabled and no project scope, then
  renders the conversation-only answer normally.
- #34 - All memory scope works. `rag-empty-memory.dbtest.ts` seeds a synthetic capture into real
  SQLite/FTS storage, invokes the production `rag:chat` IPC handler in All memory mode, and proves
  the local-model prompt, answer, streamed retrieval count, and returned `[S1]` citation all carry
  the exact matching source.
- #38 - Stop before first token. `MemoryChat.chat-lifecycle.test.tsx` holds the real rendered turn
  at the preload persistence boundary, clicks Stop during the pre-stream window, proves the model
  transport never starts, and immediately completes a second turn normally.
- #39 - Stop during streaming. The same integration routes a live token through production stream
  ownership, clicks Stop, verifies cancellation uses that stream ID, and proves the partial answer
  remains visible and persisted while the busy state clears.
- #41 - Conversation switch isolation. The same integration starts and streams conversation A,
  switches the rendered screen to B, proves B receives none of A's partial or completed state, then
  reopens A and retrieves its correctly persisted result.
- #42 - Project switch isolation. The same integration sends from Project Alpha, changes the real
  project selector to Project Beta while the model boundary is pending, and proves the result and
  parsed HTML artifact retain the Alpha project and conversation captured at send time.
- #43 - Chat survives relaunch. `e2e/chat-memory.spec.ts` creates multiple scoped and unscoped
  conversations with messages and context through production IPC, fully closes Electron, reopens
  the same profile, and verifies every association and payload through the reloaded preload path.
- #48 - Error clears busy state. `MemoryChat.chat-lifecycle.test.tsx` rejects a live turn at the
  native-model boundary, proves the rendered error is useful and Stop clears, then sends and renders
  a successful second turn through the same production composer.
- #52 - Attach a knowledge document. `rag-store-integration.dbtest.ts` drives a real Markdown file
  through production extraction/chunking, real SQLite persistence and retrieval, and prompt
  formatting, with only the local embedding-model boundary deterministic.
- #53 - Project retrieval is grounded. `rag-store-integration.dbtest.ts` indexes real Markdown
  files into two projects through the production RAG service and SQLite store, then proves selected
  project and enabled-document filters exclude obsolete and cross-project facts from retrieval and
  prompt context.
- #51 - Create a project. `src/main/__tests__/rag-store-integration.dbtest.ts` exercises the real
  project store against temp SQLite and verifies the round trip.
- #56 - Delete project cascades. `src/main/__tests__/project-delete-cascade.dbtest.ts` uses the real
  project, conversation, message, artifact, document, and chunk paths and proves no orphans remain.
- #63 - Image cancellation keeps text. `MemoryChat.tool-image-cancel.test.tsx` drives the real
  rendered MemoryChat path with the image engine as the external boundary and verifies the text
  turn persists.
- #61 - Text prompt generates an image. `MemoryChat.image.test.tsx` drives the real rendered image
  composer through its preload boundary, holds the native image job pending, emits live production
  progress, then proves exactly one generated image reaches the conversation.
- #62 - Image cancellation is scoped. The same rendered integration starts an image job in one
  conversation, switches conversations, and proves progress and Stop stay with the owning
  conversation; stopping it calls the native cancellation boundary exactly once.
- #68 - Vision answers about attachment. The rendered composer processes a ready image attachment,
  sends its persisted path and the exact typed question through the production vision path, and
  renders the returned answer.
- #69 - Text-only model guards image input. The same integration proves an unavailable vision
  capability produces a visible explanation before image processing or model delivery, then
  completes a text-only turn normally.
- #73 - Connector tool executes. The real connector extension executes a read-only tool through
  its remote boundary and returns the result; `tools-loop.dbtest.ts` proves extension output flows
  through the production tool loop into the final answer.
- #74 - Write tool requires approval. `mcp-connector-tool-extension.dbtest.ts` uses real connector
  state and the production extension to prove a write is queued at the approval boundary before
  the remote call can execute.
- #75 - Stop prevents connector side effect. `tools-loop.dbtest.ts` aborts after the streamed tool
  call but before extension execution and proves the side-effect implementation is never invoked;
  the dispatch guard ensures connector tools use that same abstraction.
- #76 - Expired connector becomes error. The connector integration injects an authorization
  failure only at the remote boundary and proves the real SQLite connector changes to an error
  state with an actionable detail while healthy tools remain available.
- #79 - Gateway models endpoint. `e2e/smoke.spec.ts` starts the real Electron gateway, seeds an
  active model only inside the disposable profile, calls `/v1/models` over HTTP, and verifies
  modality metadata in both supported response shapes.
- #80 - Gateway chat streaming. `model-server-chat.integration.test.ts` sends an
  OpenAI-compatible streaming request through the real HTTP gateway to a loopback llama-server
  boundary and proves the first SSE token arrives before upstream completion, later chunks retain
  their content, and the stream terminates with `[DONE]`.
- #84 - Capture disabled means no capture. `capture-disabled.integration.test.ts` backs the real
  capture state machine with the production settings store and proves the persisted privacy pause
  survives hydration, prevents OS capture work across ticks, and resumes only after user action.
- #85 - OCR creates searchable memory. `capture-exclusion.dbtest.ts` drives a normal surface through
  screenshot, OCR, the real extractor, model transport, and SQLite persistence, then queries the
  production observation search and retrieves the derived memory; only OS capture/OCR and the
  native model socket are controlled boundaries.
- #86 - Sensitive or excluded apps are omitted. `capture-exclusion.dbtest.ts` drives the production
  extractor and real SQLite persistence, with only screenshot/OCR and the model socket at their
  external boundaries, and proves configured apps, authentication surfaces, private browser
  windows, and password-manager URLs stop before capture while a normal app still persists.
- #87 - Replay timeline renders. `e2e/pro.spec.ts` launches the real Pro build path with synthetic
  data and verifies Replay renders instead of the upgrade screen.
- #90 - Unified search finds each source. `pro/main/__tests__/universal-search.dbtest.ts` writes
  captured and connector-derived observations plus meeting, entity, fact, memory, chat, and
  knowledge records through their production SQLite owners, then proves one production search
  returns every source with its real facet and deep-link identifier.
- #94 - Delete all removes capture corpus. `pro/main/__tests__/personal-data.integration.test.ts`
  registers the real Pro personal-data owner, runs the real delete-all path, and verifies the
  observations corpus is gone.
- #95 - Meeting detection is truthful. `meeting-lifecycle.integration.test.ts` drives the production
  classifier and controller with only active-window/native-recording boundaries controlled. It
  proves supported presence starts once, explicit lobby/post-call states do not record, leaving
  warns then stops, and the capture resource is released.
- #96 - Manual meeting recording. `MeetingsScreen.integration.test.tsx` renders the real screen and
  recorder hook, clicks Record then Stop, and proves exactly one sane-duration completed meeting is
  visible with capture inactive.
- #100 - Dictation pastes at cursor. `paste-at-cursor.test.ts` exercises the real dictation sink
  with only the OS automation boundary faked, including ordering and clipboard restoration.
- #112 - Approval queue gates actions. `approvals.integration.test.ts` exercises real proposal,
  decision, execution, failure, and audit persistence against SQLite.
- #116 - CRM processing tolerates schema upgrades. `crm-schema-upgrade.dbtest.ts` creates a real
  legacy SQLite schema, drives the production observation funnel, verifies additive migration and
  row preservation, then reopens the database and proves processing remains idempotent.
- #117 - Clipboard records text. `e2e/pro.spec.ts` writes unique text to the real OS clipboard and
  waits for the production poller and encrypted history store to expose that exact item over IPC.
- #121 - Clipboard restore text. The same E2E journey overwrites the OS clipboard after capture,
  restores the stored item through production IPC, and verifies the original text returns.
- #122 - Clipboard restore file. `e2e/pro.spec.ts` drives the real capture-to-restore path and
  verifies macOS receives path text, file URL, and native bytes, including an image-file case.
- #125 - Create and unlock vault. `vault-service.test.ts` uses real KDBX4, Argon2id, WASM crypto,
  and a real temp directory; correct and incorrect passwords are covered.
- #126 - Vault item types round-trip. `vault-service.test.ts` covers real encrypted CRUD and binary
  attachment persistence across lock and unlock.
- #128 - Vault recovery and backup. `vault-service.test.ts` and `vault-recovery.test.ts` exercise
  real KDBX export bytes, recovery setup, wrong phrases, and recovery to a new password.
- #132 - Settings survive relaunch. Existing journeys 129 and 131 cover model residency and
  resource settings across relaunch. Core and Pro `settings-persistence.dbtest.ts` tests add the
  other owning stores: they change software-update, capture-privacy, identity, and proactive
  delivery settings over real encrypted SQLite, close the database, reload every Off Grid module,
  rehydrate each owner, and verify every value restores.
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
- #138 - Pro license activates. `licensing.integration.test.ts` activates through the production
  IPC/service against a remote license boundary, proves the cached key is encrypted, reloads every
  module, and verifies the synchronous entitlement gate still unlocks Pro. The rendered Upgrade
  screen proves the user sees activation and the required restart action.
- #140 - Offline entitlement behavior. The licensing integration activates a lifetime entitlement,
  reloads with its network boundary unavailable, and proves the signed cache remains entitled while
  both a fresh profile and an expired cached entitlement stay locked.
- #145 - Cold relaunch after forced quit. `e2e/chat-memory.spec.ts` kills the real Electron main
  process during non-destructive chat activity, waits for process exit, reopens the same profile,
  and verifies clean boot, preload availability, usable input, and durable committed chat data.
- #147 - Engine restart recovers. `image-runtime-reliability.integration.dbtest.ts` crashes the
  native llama executable boundary while a real gateway request waits, proves the production service
  marks it down, starts exactly one replacement, and returns the recovered chat response. Teardown
  verifies the gateway/model ports rebind and every owned child process exits.

## Covered P1 journeys

- #18 - Vision model downloads. `model-download-matrix.integration.test.ts` proves a real catalog
  vision model remains unavailable until both weights and projector finish, then activates the exact
  primary/projector pair persisted by the production manager.
- #19 - Speech model downloads. The same matrix downloads every Parakeet file, activates it through
  the manager, and runs the production transcription selector against only a native executable fake
  to return synthetic dictation text.
- #20 - TTS model downloads. `model-download-tts.integration.dbtest.ts` downloads all voice files,
  activates SQLite-backed speech residency, and drives production synthesis to a valid WAV through
  only the heavyweight worker boundary.
- #21 - Image model downloads. The model matrix holds a multi-file catalog image runtime unavailable
  until its full file set lands, then proves the production image status and active selection agree.
- #23 - Delete does not cancel another download. The matrix holds one real HTTP download pending,
  deletes a different installed model through the production manager, then completes and installs
  the untouched in-flight model.
- #24 - Offline download fails clearly. `model-integrity.integration.test.ts` drives the real model
  manager through an offline fetch failure, verifies a clear network-unavailable error and clean
  filesystem state, preserves an existing installed model, then retries successfully with the same
  manager and exact GGUF bytes.
- #29 - Active modal models survive relaunch. `model-integrity.integration.test.ts` installs and
  activates real image, STT, and TTS catalog fixtures, reloads every manager module, and proves each
  persisted modality restores its own selection without crossing into another modality.
- #30 - Deleting an active model clears selection. `model-integrity.integration.test.ts` activates
  installed text, vision, image, speech, and transcription fixtures through the production model
  manager, deletes each one, and proves all runtime and persisted selections remain cleared after a
  fresh module load.
- #35 - Empty memory degrades safely. `rag-empty-memory.dbtest.ts` invokes the real `rag:chat` IPC
  handler on an empty SQLite/RAG corpus, verifies a normal answer, empty context and zero retrieval
  counts, then completes an immediate second turn to prove the queue and controller were released.
- #40 - Queued message order. `MemoryChat.chat-lifecycle.test.tsx` sends a second message through
  the real composer while the first model-boundary promise is pending, then proves production queue
  draining preserves user/assistant order without collision, duplication, or loss.
- #45 - Delete conversation cascades. `conversation-delete-cascade.dbtest.ts` proves real messages
  and artifacts do not survive conversation deletion.
- #47 - Regenerate reply. `MemoryChat.chat-lifecycle.test.tsx` invokes the rendered Regenerate
  action, replaces the old assistant answer from the same user context, and proves both the visible
  and persisted transcripts contain one user turn and the new answer without duplication.
- #54 - New chat inherits its project. `MemoryChat.project-inheritance.test.tsx` drives the real
  composer from a project target across the preload boundary and proves both conversation creation
  and RAG retrieval receive the same project ID; reopening a saved conversation restores that scope.
- #57 - Text artifact saves and reopens. `artifact-persistence.integration.test.ts` saves exact
  text, title, conversation, and project scope through the production artifact service, reloads its
  modules, and proves the persisted artifact reopens without content or ownership drift.
- #58 - Image artifact saves and reopens. The same integration writes a real PNG to the disposable
  user-data tree, persists its metadata through the production artifact service, reloads the service,
  and proves both its source association and exact image bytes remain available.
- #60 - Unsupported document fails clearly. The production picker excludes unsupported types;
  `rag-store-integration.dbtest.ts` drives a corrupt PDF through the real parser, RAG service, and
  SQLite store and proves extraction fails clearly before documents, chunks, or embeddings exist.
- #65 - Image runtime eviction recovers. `image-runtime-reliability.integration.dbtest.ts` starts
  the real chat service against a native executable boundary, generates an image through the real
  modality queue to evict it, then proves a second native chat process starts and answers the next
  message without an application restart.
- #67 - Generated image opens. `MemoryChat.image.test.tsx` opens the generated output in the shared
  lightbox, exports the exact production path and filename through the native save boundary, and
  closes the preview without duplicating the artifact.
- #70 - Damaged image fails safely. `files-image-upload.dbtest.ts` real-decodes image bytes with
  Sharp and proves invalid content never persists. The rendered composer shows the specific error
  on the attachment and successfully completes the next text turn.
- #72 - Connector tools load. `mcp-connector-tool-extension.dbtest.ts` discovers schemas through
  the production extension and real connector database, preserving enabled/disabled state while
  controlling only the remote MCP transport.
- #77 - Dead connector does not hang all tools. `mcp-timeout.dbtest.ts` runs the default production
  extension over real SQLite connectors and the real eight-second timeout; a non-responsive MCP
  process becomes an error while the healthy connector schema still returns.
- #78 - Connector delete removes secrets. `connector-delete-secrets.dbtest.ts` deletes through the
  production connector repository, reopens the encrypted database, and proves all owned OAuth,
  PKCE, client-registration, and env secrets are gone while unrelated secrets remain readable.
- #81 - Gateway image route. `model-server-image.integration.dbtest.ts` sends a real HTTP request
  through the production gateway, image orchestrator, modality queue, SQLite residency owner,
  argument builder, and generated-image filesystem. Only the native `sd-cli` executable is faked;
  the test verifies its PNG reaches the OpenAI-compatible response and disk, plus the missing-runtime
  path returns a stable `not_installed` envelope.
- #82 - Gateway failure envelope. `model-server-chat.integration.test.ts` sends malformed input
  through the real HTTP gateway, proves it receives the stable OpenAI-style JSON error contract
  without reaching the native model boundary, then calls the gateway again to verify it stays healthy.
- #89 - Replay navigation preserves target. `DayReplay.integration.test.tsx` opens the rendered
  Replay screen at an exact synthetic capture timestamp, serves the emitted `ogcapture://` file
  through the production protocol owner, and proves keyboard playback advances to the next frame.
- #91 - Search filters and sort apply. The universal-search DB integration proves production source,
  recency, and match filtering over fresh results; `SearchScreen.integration.test.tsx` drives the
  rendered filter and sort controls and verifies visible ordering changes without stale rows.
- #92 - Day briefing renders. `DayReplay.integration.test.tsx` backs the rendered Day view with real
  SQLite and filesystem owners plus the real LLM service over a native-engine HTTP boundary, then
  proves priorities, meetings, suggestions, journal, time spent, and timeline all render.
- #98 - Meeting survives relaunch. `meeting-persistence.dbtest.ts` saves synthetic meeting media,
  transcript, and local-model summary through production filesystem/SQLite owners, closes the DB,
  resets modules, and proves the exact audio metadata, transcript, and summary restore.
- #107 - Entities are synthesized. `entity-action-journeys.dbtest.ts` records person, project, and
  company mentions through production observation and entity owners, proving one correctly typed
  record per entity with automatic identifiers and two supporting observations.
- #108 - Self mentions are filtered. The same real-DB integration stores the user's name and aliases,
  passes mixed mentions through production identity filtering, and proves only the external person
  becomes an entity.
- #109 - Entity detail opens. `EntityNavigation.integration.test.tsx` drives the real Search result
  gesture into the real Entities screen and proves the selected ID's type, narrative, handle, and
  both evidence rows remain consistent across entry points.
- #110 - Entity merge preserves evidence. `resolve.integration.test.ts` exercises real entity,
  aliases, observations, relationships, action reassignment, split, and merge persistence.
- #111 - Action items are extracted. `entity-action-journeys.dbtest.ts` sends a synthetic commitment
  through the production extractor over a loopback native-model boundary and proves exactly one
  imperative action persists with its due date and source evidence.
- #113 - Action status survives persistence. `actions-status.integration.test.ts` exercises real
  status, reopen, dismiss, feedback, ordering, and reason storage against SQLite.
- #115 - Reflect uses real time ranges. `reflect.integration.test.ts` verifies real observation
  windows, dwell caps, category rollups, context switches, and seven-day aggregation.
- #118 - Clipboard deduplicates repeated copy. `clipboard-store.integration.test.ts` exercises the
  real store and proves timestamp bump-to-top without duplicate rows or lost tags.
- #119 - Clipboard records images and files. `e2e/pro.spec.ts` captures real file URLs and a new
  pixel bitmap, then restores the bitmap bytes and verifies their exact dimensions.
- #120 - Clipboard live refresh keeps valid selection.
  `ClipboardScreen.integration.test.tsx` renders the real screen and proves selection is retained
  while the item exists, then moves to a valid remaining item after deletion.
- #129 - Runtime residency toggles persist. `e2e/settings-residency.spec.ts` changes image, STT,
  and TTS through the real Settings controls, verifies production IPC, fully relaunches Electron,
  and verifies all values reload. The SQLite and runtime-manager integrations prove that same map
  controls persistence and re-warm behavior.
- #127 - Vault copy actions. `e2e/pro.spec.ts` creates a real encrypted KDBX entry through
  production IPC and verifies username, revealed password, and URL copy into the OS clipboard.
- #130 - Chat residency stays required. `e2e/settings-residency.spec.ts` verifies the production
  switch stays checked and disabled before and after relaunch, while the real SQLite integration
  proves an on-demand write is normalized back to `resident`.
- #131 - Resource mode applies. `resource-mode.integration.test.ts` drives all three presets through
  the real LLM settings owner, disk persistence, fresh-service launch arguments, recommendation,
  and setup planner with only host RAM controlled; the Electron tour proves selection stays
  responsive and the sizing guards enforce memory clamps.
- #133 - Storage usage is truthful. `storage-usage.integration.dbtest.ts` writes exact synthetic
  model, capture, meeting, image, artifact, and thumbnail byte counts to a temp profile, then proves
  production storage owners and the rendered Storage/Data Privacy panels report their real totals,
  categories, models, and orphaned partials.
- #139 - Invalid or exhausted license fails clearly. `licensing.integration.test.ts` drives invalid
  and device-limit responses through the production service and proves entitlement remains false;
  `UpgradeScreen.license.test.tsx` verifies distinct actionable messages remain on the locked screen.
- #141 - Core and Pro override behavior. The licensing integration applies both development
  overrides through the production bootstrap seam and proves neither mutates the encrypted persisted
  entitlement; a core build remains incapable of force-loading Pro implementation code.
- #142 - Manual update check. `update-check.integration.dbtest.ts` exercises available, current,
  remote-error, timeout, cleanup, and retry results through the production updater IPC owner, while
  `Settings.update-check.test.tsx` proves the rendered action never stays stuck in Checking.
- #143 - Update channel persists. `src/main/__tests__/settings-persistence.dbtest.ts` changes the
  channel through the production update IPC handler, closes the encrypted database, reloads every
  Off Grid module, and verifies the fresh update-preferences handler restores the beta channel.
- #154 - External links use the system browser. `e2e/tour.spec.ts` drives the real locked-Pro
  surface through Electron preload and IPC, proves purchase and Mobile links reach
  `shell.openExternal` with their production URLs, and verifies the Electron page never navigates.

## Covered P2 journeys

- #46 - Copy assistant reply. `MemoryChat.clipboard-overlay.test.tsx` invokes Copy on an assistant
  message, proves its exact text reaches the native/browser clipboard boundary, and verifies visible
  success feedback only after the copy completes.
- #55 - Edit project. `rag-ipc-project-create.dbtest.ts` changes every editable field through the
  production project IPC handlers and real SQLite store, reloads the modules, and proves the updated
  project is returned with its exact name, description, prompt, icon, and memory setting.
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

- #22 - Multiple downloads queue.
- #31 - Models use desktop density.

## Left - chat and conversations

- #36 - Thinking streams separately.
- #37 - Plain reply hides think markers.
- #44 - Rename conversation.
- #49 - Long answer respects configured cap.
- #50 - Keyboard and navigation shortcuts.

## Left - projects and artifacts

- #59 - Project list uses desktop layout.

## Left - image and vision

- #64 - Image settings apply.
- #66 - Image RAM guard is safe.

## Left - integrations and gateway

- #71 - Connector can be added.

## Left - capture, memory, and replay

- #83 - Screen capture permission path.
- #88 - Replay playback uses media server.
- #93 - Day links open correct records.

## Left - meetings, voice, and dictation

- #97 - Meeting transcript and summary.
- #99 - Global dictation hotkey.
- #101 - Dictation paste failure is visible.
- #102 - Dictation engine selection.
- #103 - Import media for transcription.
- #104 - Voice retention settings apply.
- #105 - Speak assistant reply.
- #106 - Mic and TTS stop cleanly.

## Left - entities, actions, and reflection

- #114 - Notifications open their target.

## Left - clipboard and vault

- #123 - Clipboard popup hotkey.

## Left - settings, privacy, licensing, and updates

- #134 - Clear cache preserves user data.

## Left - resilience and desktop polish

- #144 - Local use works offline.
- #146 - Model ports are single-owner.
- #148 - Low disk space is handled.
- #149 - Large seeded collections stay usable.
- #150 - Window resize preserves desktop layout.
- #151 - Keyboard focus is visible.
- #152 - Escape closes transient UI.
- #153 - Reduced motion remains usable.
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
