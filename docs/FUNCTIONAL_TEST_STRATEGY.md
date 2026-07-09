# Functional test strategy — ensure features actually work, across every surface

The unit-coverage ratchet (vitest, ~54%) proves *pure logic* is exercised. It does NOT prove
*a feature works* - the boot crash and the "tools don't stream" fork both passed typecheck +
unit tests + build. This doc tracks FUNCTIONAL tests (unit + integration) per product surface,
including the native (Swift) code, so "does capture -> OCR -> memory -> chat actually work" has
an answer that a test enforces. Bring in whatever framework a surface needs.

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
| STT (whisper-cli / parakeet) | integration | vitest: TTS-synth a WAV -> transcribe -> assert text; skip if model absent | TODO |
| TTS (kokoro) | integration | vitest: synth text -> assert non-empty WAV/PCM; skip if model absent | TODO |
| Image gen (sd-cli / mflux / coreml-sd) | integration | vitest spawns pipeline on a tiny model; heavy - local-gated | TODO (local only) |
| coreml-sd Swift package | swift unit | add an XCTest target; extract arg/param/size logic | TODO |
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
