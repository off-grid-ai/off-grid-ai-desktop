# Functional test strategy — ensure features actually work, across every surface

The unit-coverage ratchet (vitest, ~54%) proves *pure logic* is exercised. It does NOT prove
*a feature works* - the boot crash and the "tools don't stream" fork both passed typecheck +
unit tests + build. This doc tracks FUNCTIONAL tests (unit + integration) per product surface,
including the native (Swift) code, so "does capture -> OCR -> memory -> chat actually work" has
an answer that a test enforces. Bring in whatever framework a surface needs.

## Governing rule: test OUR code, not third-party frameworks/engines

We test the code WE own - our decision logic, our wiring, our request/response handling, our
helpers - and the integration seams between them. We do NOT write tests whose pass/fail is
really a test of a third-party framework or engine we merely depend on:

- **Exclude vendored / third-party code entirely** (e.g. `**/.build/checkouts/**`,
  `node_modules`, Apple's `ml-stable-diffusion`, `swift-argument-parser`, `whisper.cpp`,
  `llama.cpp`, the kokoro onnx runtime). Not our code -> not our tests.
- **A thin shim over a framework with no logic of our own is not worth a test** (coreml-sd is
  ~50 lines of `main.swift` around Apple's StableDiffusion - testing it tests Apple's SD).
- **An engine-backed integration test is allowed only when it exercises OUR wiring** - our
  gateway routes (`model-server.ts`), our spawn/parse of a helper WE ship, our pipeline - with
  the engine as a dependency (skip if absent), not as the thing under test. The value is
  "our integration still works," not "does Vision/whisper/kokoro work."

## Test types
- **unit (vitest)** - pure TS logic, no I/O. Fast, always-on. The ratchet floor.
- **integration (vitest, real collaborators)** - run the real implementation against a temp
  SQLite DB / temp userData / a spawned native binary / the local engine. `skipIf` the
  dependency (binary/model) is absent, so it runs on a dev Mac + release builds and SKIPS in a
  plain `npm ci` CI rather than failing. This is where "the feature works" is proven.
- **swift unit (XCTest / swift-testing via SwiftPM)** - pure logic inside a Swift package.
- **e2e (Playwright Electron)** - the rendered app tour (e2e/, 22 tests today).
- **gateway smoke (`npm run smoke`)** - the OpenAI `/v1` surface against a running app.

## Surface matrix (status - keep current)

| Surface | Kind | How | Status |
|---|---|---|---|
| RAG/chat pure logic (ranking, prompts, routing, tool loop) | unit | vitest | DONE (growing) |
| Streaming tool loop (C7) | integration-ish | vitest, faked model boundary | DONE (`tools-stream.test.ts`) |
| **Native OCR (Vision, `ocr.swift`)** | integration | vitest spawns the built binary on a rendered fixture | **DONE (`ocr-helper.integration.test.ts`)** |
| Gateway `/v1` (chat stream, embeddings, image) | smoke | `npm run smoke` vs running app | DONE (manual/pre-release) |
| STT (whisper-cli / parakeet) + TTS (kokoro) | integration | vitest: TTS->STT round-trip via the gateway; skip if gateway down | **DONE (`audio-engines.integration.test.ts`)** |
| Image gen (sd-cli / mflux) | integration | vitest: gateway `/v1/images/generations` on the installed model; heavy - local-gated, skip if no image model | TODO (local only) |
| coreml-sd Swift package | - | **EXCLUDED - not our code.** ~50-line `main.swift` shim over Apple ml-stable-diffusion; testing it tests Apple's SD, not our logic. Covered indirectly by the gateway image-gen integration test when it is the active runtime. |
| Accessibility watcher (`main.swift`) | integration | needs TCC (accessibility) - local-gated, spawn + assert JSON shape | TODO (local only) |
| text-extractor / inspect_layout `.swift` | integration | spawn on a fixture; assert output shape | TODO |
| Capture -> OCR -> memory ingest seam | integration | vitest: feed a fixture frame through the ingest path into a temp DB | TODO |
| RAG end-to-end (retrieve -> prompt -> answer) | integration | vitest: seed a temp SQLite, run retrieval, assert grounded context | TODO |
| Vault (kdbx + Argon2) | integration | vitest vs temp dir | DONE (`vault-service.test.ts`) |
| Renderer surfaces render | e2e | Playwright tour | DONE (22) |
| Pro dictation / clipboard / replay | e2e + unit | Playwright (`pro.spec.ts`) + pro unit | PARTIAL |

## Rules
- An integration test that needs a binary/model MUST `skipIf` it is absent and say so - never
  fail because CI lacks the artifact, never silently pass by mocking the thing under test.
- Prefer a real round-trip (e.g. TTS->STT) over a hand-crafted fixture where it makes the test
  more honest.
- A native helper is tested through the SAME interface the app uses (spawn the compiled binary),
  so the test breaks when the real integration breaks.
- New feature => a functional test for it in the same change (see the top-level testing rule).
