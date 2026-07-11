# Off Grid AI — Core Feature Matrix for Windows

Tracking sheet for bringing the **core (free, open-source) app** to Windows on the
`feat/windows-support` branch. This branch is our working `develop` for Windows —
branch off it for every change.

**Scope: core only.** "Core" = the free studio + gateway (everything in
[FEATURES.md](FEATURES.md)). The **Pro** "sees / remembers / acts" layer lives in the
excluded `pro/` submodule (`!pro/**` in `electron-builder.yml`), ships macOS-signed
binaries only, and is **out of scope here** — see the [Pro section](#pro-layer-out-of-scope)
at the bottom.

> Statuses reflect **code inspection on this branch, not a verified run on Windows.**
> Nothing below has been executed on real Windows hardware yet — "needs testing" is the
> ceiling until someone runs the CI artifact on a Windows machine.

## Legend

| Status | Meaning |
|---|---|
| 🟢 **Present — needs testing** | Cross-platform code path exists and any Windows-specific handling is implemented. Not yet verified on a real Windows machine. |
| 🟡 **At risk — needs testing** | Implemented, but there's a known Windows-specific gap or fragile spot to confirm during testing (details in notes). |
| 🔴 **Not present** | Not built / not wired for Windows yet. Work required. |
| ⚪ **N/A — Apple-only by design** | Will never run on Windows (Apple Silicon / Core ML / macOS Vision). Feature degrades gracefully; a cross-platform fallback usually covers it. |

---

## 1. Build, packaging & distribution

| Item | Status | Notes / evidence |
|---|---|---|
| Windows CI build | 🟢 | `.github/workflows/windows-build.yml` — `windows-2022` runner, builds + packages on push to this branch. Uploads the installer as a **workflow artifact only** (`--publish never`); does not cut a release. Never run on a real machine yet. |
| Native-module compile (node-gyp) | 🟢 | Pinned toolchain: `windows-2022` (VS 2022) + Python 3.12. `windows-latest`/VS 2026 + Python 3.13 break node-gyp 11 — documented in the workflow. Covers `better-sqlite3-multiple-ciphers`, `node-llama-cpp`, `sharp`. |
| Windows runtime binaries fetch | 🟢 | `scripts/fetch-win-binaries.ps1` pulls win64 `llama-server` / `whisper-cli` / `sd-cli` / `ffmpeg` (+ DLLs) from upstream GitHub releases at build time — **versions resolved dynamically** (no longer stale). Repo LFS binaries are macOS-only and skipped (`lfs: false`). Fails loud if `llama-server.exe` is missing. |
| NSIS installer | 🟢 | `electron-builder.yml` → `win.executableName`, `nsis` block (desktop shortcut, uninstall name). Untested end-to-end. |
| Code signing | 🟡 | Optional via `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets; **unset → unsigned build → SmartScreen will warn** on install. No cert configured yet. |
| Auto-update | 🟡 | `electron-updater` code is cross-platform (`src/main/updater.ts`), and NSIS is a supported target. But `windows-build.yml` publishes nothing, so **no Windows update feed (`latest.yml`) is published** — auto-update won't function until a windows job is folded into `release.yml`. |

---

## 2. Core runtime features (the studio)

| Feature | Status | Depends on | Notes / evidence |
|---|---|---|---|
| **The Gateway** (OpenAI-compatible API on `:7878`) | 🟢 | llama-server + Node HTTP | No platform-specific code; rides on chat. Headless `--server-only` path is pure Node. |
| **Chat** (text + vision + reasoning, streaming) | 🟢 | `llama-server.exe` | `src/main/llm.ts` is the most Windows-hardened path: `exe()` suffix, DLL-dir prepended to `PATH`, and orphan-port cleanup via `netstat`/`tasklist`/`taskkill`. Highest-confidence runtime. |
| **Model catalog + Hugging Face download** | 🟢 | Node fetch | `@offgrid/models` + `models-manager.ts` — pure JS, downloads into userData. Path handling is cross-platform. |
| **Image generation — SD/SDXL/Z-Image (GGUF)** | 🟡 | `sd-cli.exe` | `src/main/imagegen.ts` uses `exe('sd-cli')` and the fetch script ships the win build + DLLs. **Gap to check:** the spawn only sets `cwd = binary dir` (`imagegen.ts:628`) and, unlike `llm.ts`, does **not** prepend the bin dir to `PATH`. Relies on Windows' default "load DLLs from the exe's own directory" behaviour — verify SD DLLs resolve. |
| ↳ Image gen — **MLX / FLUX.2 / Z-Image-via-MLX** | ⚪ | mflux (Apple MLX) | `src/main/mflux.ts` is explicitly Apple-Silicon-only (`process.platform !== 'darwin'` gated off). On Windows, MLX models are simply not offered; **Z-Image still works via the `sd-cli` GGUF path.** |
| ↳ Image gen — **Core ML / ANE acceleration** | ⚪ | `coreml-sd` (Swift) | macOS-only, gated off in `imagegen.ts`. Windows uses the standard `sd-cli` path. |
| **Voice — Speech→Text** (whisper.cpp) | 🟢 | `whisper-cli.exe` + `ffmpeg.exe` | `src/main/rag/extractors.ts` uses `exe('whisper-cli')` / `exe('ffmpeg')`; both fetched by the PS1 script. ffmpeg is a self-contained static build. Untested. |
| **Voice — Text→Speech** (Kokoro-82M) | 🟢 | onnxruntime-node worker | `src/main/tts.ts` runs the worker as Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`) with a cross-platform prebuilt ORT. No platform branching. Untested. |
| **Hands-free voice mode** | 🟢 | STT + TTS above | Renderer orchestration only; inherits STT/TTS status. |
| **Embeddings** (`@xenova/transformers`) | 🟢 | onnxruntime-node | Prebuilt native runtime, cross-platform. Powers RAG + `/v1/embeddings`. |
| **Projects / RAG** (docs, cited retrieval) | 🟢 | LanceDB + better-sqlite3 | Text/PDF/DOCX extraction is pure JS; vector store is `@lancedb/lancedb` (native, compiled in CI). Image docs are captioned by the **vision model** (not OCR), so they're cross-platform. Audio/video ingestion inherits whisper/ffmpeg status. |
| **Artifacts / canvas** (HTML/React/SVG/Mermaid) | 🟢 | Renderer only | Sandboxed iframe, no platform code. Very high confidence. |
| **Connectors (MCP)** | 🟢 | stdio / HTTP transports | HTTP/SSE connectors are platform-neutral. stdio connectors spawn via `StdioClientTransport` (`src/main/mcp.ts:114`), whose SDK uses **`cross-spawn`** — which resolves `npx` → `npx.cmd` via `cmd.exe /c` on Windows automatically. The classic gotcha is already handled by the dependency; still worth a live test. |
| **Tools in chat** (calculator, datetime, web search) | 🟢 | Node | `src/main/tools.ts` — pure JS. Web search is the one intentionally-online feature (DuckDuckGo fetch). |
| **Encryption at rest** | 🟢 | `better-sqlite3-multiple-ciphers` | Native module compiled in CI (node-gyp). Cross-platform SQLite cipher. |
| **Onboarding / Settings / Command palette / theming** | 🟢 | Renderer only | Pure web UI, no platform code. |

---

## 3. Known Windows risks to confirm during testing

Ordered by likelihood of biting:

1. **Nothing has run on Windows yet.** Every 🟢 above is "code looks right," not "verified." First real test = download the CI artifact and launch it on Windows 10/11. No *known-required* runtime code fix exists — the coding below is either shipping plumbing or contingent on what this first run breaks.
2. **`sd-cli` DLL resolution** — `imagegen.ts:628` sets `cwd` but not `PATH` (chat's `llm.ts` does both). Windows searches the exe's own dir for DLLs by default, so this is *probably* fine; if SD fails to load its DLLs, mirror the `llm.ts` `PATH`-prepend fix (a few lines).
3. **Upstream binary compatibility** — the fetched llama/whisper/sd builds are CPU/AVX2 x64 baselines; confirm they spawn (no missing VC++ redistributable, correct AVX level) on target hardware.
4. **Unsigned installer / SmartScreen** — expected until a signing cert is added; will scare testers.
5. **Auto-update feed not published** for Windows — installs won't self-update until a windows job lands in `release.yml`.

---

## 4. How to produce a Windows build

Push to `feat/windows-support` (or trigger `Windows Build (branch)` manually from the
Actions tab) → download the `off-grid-ai-windows` artifact → install on a Windows machine.
Do **not** expect it in GitHub Releases; this workflow deliberately doesn't publish.

---

## Pro layer (out of scope)

The Pro "sees / remembers / reflects / acts" layer is **not part of core** and is **not
present on Windows** (🔴). Its native binaries are macOS-only:

- Screen capture watcher (Swift) and meeting recorder — macOS binaries added by the Pro build.
- **OCR** — `src/main/ocr.ts` shells out to a bundled **macOS Vision** binary; no Windows equivalent. (Note: this is *not* used by core image-RAG, which captions via the vision model.)
- macOS permissions (screen recording / accessibility) — `src/main/permissions.ts` is fully `darwin`-gated and no-ops elsewhere.

Porting Pro to Windows is a separate effort and not tracked in this matrix.
