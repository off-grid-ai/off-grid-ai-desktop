# Code-quality backlog — what's NOT done yet

Remaining SOLID/DRY/cleanup work, after the `chore/quality-hardening` branch landed the
4 real bugs, the safe DRY consolidations, the coverage campaign, and the quality-tooling
spine. Everything below is deliberately deferred: each either rewrites an engine contract
on a coverage-excluded I/O path (can't be verified live headless) or needs visual/on-device
verification. Land each as its own reviewed change with real verification — not a blind sweep
(the merge gate forbids shipping an unverified "done").

## Structural (prevents a whole bug class)
- **Renderer has no store layer** (`src/renderer/src/stores/` doesn't exist). Every screen
  re-fetches + holds its own `useState` copy — the root of the "local copy drifts" bug class
  (image composer, ProjectsScreen doc-toggle, …). A thin per-domain store (owns the fetch +
  write-through) prevents it structurally instead of fixing it screen-by-screen.

## Core — DIP / SRP (engine contracts; need live verification)
- **`ImageRuntime` interface** — `imagegen.runImageGen` chooses among 4 interchangeable runtimes
  (mflux/coreml/sd-server/sd-cli) via a predicate cascade in one ~350-line fn; a 5th needs edits
  in ≥3 places. Fold `models-manager` `runtime==='mflux'` install/delete/isCached into the same
  abstraction. Needs live image-gen to verify.
- **`imagegen.ts` SRP split** — listing/delete/LoRA/GGUF-sniff/resolve-policy/orchestration in one
  file. Split model-resolve / gguf-inspect / loras.
- **`ipc.ts rag:chat` god-handler split** — `retrieveContext()` + `ftsBlock()` (5 near-identical
  FTS blocks remain; the app-name filter is already unified via `appNameLikeClause`).
- **`database.ts` split (1339 lines)** — key mgmt + cosine + DDL/migrations + 6 domains' queries →
  connection/schema/per-domain repos + `vector-math.ts`. Native-DB path; behavior-risk.

## Core — correctness (needs live image-gen)
- **Z-Image guard-vs-run regex** — the memory guard sizes a *different* match than the run loads,
  so residency estimates can be wrong for the Z-Image stack.

## Core — brand (needs screenshot verification)
- **`@tabler/icons-react` → Phosphor** in ModelsScreen / StoragePanel / ConnectorsScreen
  (CLAUDE.md mandates Phosphor-only). Many-icon swap; each glyph + weight verified visually.

## Pro — DIP / SRP
- **`ConnectorIngestor` interface** — `ingest.ts` dispatches on connector identity (URL substring +
  tool-name sniff); adding a connector edits ≥4 fns. Per-connector object declares
  category/buildQuery/pickTool; dispatcher picks first `matches()`. Needs live MCP connectors.
- **SRP splits** (sequence AFTER the seams): `agent.proposeActions`,
  `extract.extractObservationFromScreen`, `vault-service` unlock/recovery (inject a VaultStore).

## Lint backlog surfaced by the new gates (warn-ratchet — grind down, tighten to error as areas clear)
- **`@typescript-eslint/no-unnecessary-condition`**: ~289 dead-branch findings (190 core, 99 pro),
  concentrated in the god-files (MemoryChat 42, ipc 12, App 12). Triage — some are dead branches to
  delete, some are guards at untyped boundaries where the fix is to correct the TYPE.
- **sonarjs on pro/**: ~295 findings (mostly cyclomatic/cognitive complexity on the CRM god-files +
  duplicate strings). Decompose hotspot-first, test-covered.
- **knip**: 27 unused dependencies, 84 unused exports, 30 unused exported types. Triage carefully —
  a "dead" dep may be used in a build/runtime path knip can't trace; never blind-`npm remove`.

## Evaluated and intentionally NOT changing (don't re-flag)
`isMe` (token-overlap, DB-sourced) vs `isSelfName` (substring-position, injected list) — different
matchers, not a dup. `markdownComponents` maps — intentionally styled per surface. `dayKey` (string)
vs `dayKeyOf` (epoch-sec number) — different functions. dictation `buildSinks` — it's the factory
itself (the delivery loop is already polymorphic over `OutputSink`); a SinkFactory is speculative
(YAGNI) with two sinks.
