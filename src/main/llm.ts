import { spawn, execSync, ChildProcess } from 'child_process'
import os from 'os'
import { Mutex } from 'async-mutex'
import { callHook } from './bootstrap/hookRegistry'
import path from 'path'
import * as fs from 'fs'
import { modelsDir as getModelsDir, binRoots, isPackaged, onHostQuit, exe } from './runtime-env'
import { killOrphansOnPort as reapOrphansOnPort } from './kill-orphan-port'
import { computeSafeCtx, modeBudget, type KvCacheType, type PerformanceMode } from './model-sizing'
import { resolveMaxTokens } from './llm/gen-params'
import { classifyLlamaError } from './llama-error'
import type { ManagedRuntime } from './runtime-manager'
import { LLAMA_SERVER_PORT } from '../shared/ports'
import { DEFAULT_CTX_SIZE } from '../shared/llm-defaults'
import {
  applyModePreset,
  samplingPayload,
  launchArgsChanged,
  buildLaunchArgs,
  type PresetField
} from './llm/settings-math'
import { buildMessages, imageMime, thinkingPayload, type DecodedImage } from './llm/chat-payload'
import { isValidGgufFile } from './models/gguf'
import { type AssembledToolCall } from './llm/sse-stream'
import { postCompletionOnce } from './llm/http-post'
import { streamCompletion } from './llm/stream'

export type { KvCacheType, PerformanceMode }

export interface LlmSettings {
  performanceMode?: PerformanceMode
  temperature?: number
  ctxSize?: number
  topP?: number
  topK?: number
  minP?: number
  repeatPenalty?: number
  maxTokens?: number
  systemPrompt?: string
  // Launch-time (require a server respawn to take effect):
  kvCacheType?: KvCacheType // quantize the KV cache to cut memory (needs flash-attn)
  flashAttn?: boolean // FlashAttention: faster + lower memory; required for quantized KV
  gpuLayers?: number // -ngl: layers offloaded to GPU (Metal). 99 = all.
  threads?: number // CPU threads for inference
  batchSize?: number // -b: prompt batch size
}

export class LLMService {
  private server: ChildProcess | null = null
  // Off the contested 8080 (collides with other local dev servers) onto a
  // less-trafficked port so the model server reliably binds.
  private port = LLAMA_SERVER_PORT
  // Single-flight init guard: concurrent chat() calls (e.g. the capture
  // extractor firing rapidly) must share ONE spawn, not each launch a server.
  private initPromise: Promise<void> | null = null
  private modelPath = ''
  private mmProjPath = '' // empty for text-only models (no vision projector)
  private initialized = false
  // Paused during image generation: on Apple Silicon unified memory the LLM and
  // the image model can't both be resident. While paused we DON'T respawn the
  // server — capture keeps running but its LLM distillation is deferred until
  // generation finishes (and the LLM warms back up).
  private paused = false
  // Resolve lazily: the data dir can be set AFTER this class is constructed
  // (e.g. an OFFGRID_USER_DATA / standalone-gateway override), so computing the
  // path at construction would pin it to the wrong location and miss active-model.json.
  private get activeModelFile(): string {
    return path.join(getModelsDir(), 'active-model.json')
  }
  // User-tunable inference settings (persisted). Context window needs a server
  // respawn to take effect (it's a launch arg); temperature is per-request.
  private temperature = 0.7
  private ctxSize = DEFAULT_CTX_SIZE // modest default — context is a ceiling, not a fill-RAM target (KV cache is the bulk of memory). Raise it or use Extreme for more.
  // ONE local gemma server, but many callers (capture distill, day-plan, the
  // secretary, action extraction…). Concurrent requests contend and time out.
  // Serialize them so each gets the server to itself; the per-call timeout sits
  // INSIDE the lock, so it measures execution, not time spent waiting in line.
  private chatMutex = new Mutex()
  // Advanced sampling (LM Studio-style). undefined = let llama.cpp use its default.
  private topP: number | undefined
  private topK: number | undefined
  private minP: number | undefined
  private repeatPenalty: number | undefined
  private maxTokens = 2048
  private systemPrompt = ''
  // Resource-usage preset. Governs the RAM budget the context clamp targets and
  // the default ctx/KV preset. 'balanced' preserves prior behavior.
  private performanceMode: PerformanceMode = 'balanced'
  // Launch-time params (need a respawn). Defaults match prior hardcoded behavior.
  private kvCacheType: KvCacheType = 'f16'
  private flashAttn = false
  // Which mode-preset-governed fields (ctxSize/kvCacheType/flashAttn) the user has
  // explicitly pinned via a granular control. A mode preset only fills fields NOT in
  // this set, so choosing/reapplying a performance mode never clobbers an explicit KV
  // choice (the "q8_0 reverts to f16 on every restart" bug). Persisted alongside the
  // values so a plain restart keeps the pin.
  private readonly userExplicit = new Set<PresetField>()
  private gpuLayers = 99
  private threads: number | undefined
  private batchSize: number | undefined
  // Crash recovery: distinguish an intentional kill (stop/reload/settings respawn)
  // from an unexpected crash so we only auto-restart on real crashes.
  private intentionalStop = false
  // Timestamps of recent auto-restarts. A rolling 2-minute window caps recovery so
  // a server that keeps dying (e.g. memory pressure on a too-large model) can NOT
  // thrash-respawn a multi-GB process forever.
  private restartTimes: number[] = []
  // Last ~50 stderr lines from llama-server, so we can explain WHY it died on
  // load (unknown arch / OOM / OS-too-old) instead of a blank "Down".
  private stderrTail: string[] = []
  // Human, actionable reason the server failed to come up (null when healthy).
  private lastErrorMsg: string | null = null
  private get settingsFile(): string {
    return path.join(getModelsDir(), 'llm-settings.json')
  }

  constructor() {
    this.resolveModel()
    try {
      const s = JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'))
      if (typeof s.temperature === 'number') this.temperature = s.temperature
      if (typeof s.ctxSize === 'number') this.ctxSize = s.ctxSize
      if (typeof s.topP === 'number') this.topP = s.topP
      if (typeof s.topK === 'number') this.topK = s.topK
      if (typeof s.minP === 'number') this.minP = s.minP
      if (typeof s.repeatPenalty === 'number') this.repeatPenalty = s.repeatPenalty
      if (typeof s.maxTokens === 'number') this.maxTokens = s.maxTokens
      if (typeof s.systemPrompt === 'string') this.systemPrompt = s.systemPrompt
      if (s.kvCacheType === 'f16' || s.kvCacheType === 'q8_0' || s.kvCacheType === 'q4_0')
        this.kvCacheType = s.kvCacheType
      if (typeof s.flashAttn === 'boolean') this.flashAttn = s.flashAttn
      if (typeof s.gpuLayers === 'number') this.gpuLayers = s.gpuLayers
      if (typeof s.threads === 'number') this.threads = s.threads
      if (typeof s.batchSize === 'number') this.batchSize = s.batchSize
      if (
        s.performanceMode === 'conservative' ||
        s.performanceMode === 'balanced' ||
        s.performanceMode === 'extreme'
      )
        this.performanceMode = s.performanceMode
      // Restore which preset fields the user pinned, so a plain restart keeps an
      // explicit KV/ctx/flash-attn choice instead of letting the mode preset win.
      if (Array.isArray(s.userExplicit)) {
        for (const f of s.userExplicit)
          if (f === 'ctxSize' || f === 'kvCacheType' || f === 'flashAttn') this.userExplicit.add(f)
      }
    } catch {
      /* defaults */
    }
  }

  // Clamp the requested context window to what THIS machine + THIS model can hold
  // without overcommitting unified memory. A big -c allocates a KV cache up front
  // (with -ngl 99 it's resident in unified memory alongside the weights); on a
  // 16GB Mac an 8B model at 64k blew past physical RAM and FROZE macOS. We size a
  // KV budget from total RAM minus the model weights minus headroom for the OS,
  // Electron, and Metal compute, then cap context to fit. Better a shorter context
  // than a hard freeze; users on big machines still get a large window (it scales).
  private safeCtxSize(requested: number): number {
    try {
      const totalGb = os.totalmem() / 1e9
      let weightsGb = 0
      try {
        weightsGb += fs.statSync(this.modelPath).size / 1e9
      } catch {
        /* unknown */
      }
      try {
        if (this.mmProjPath) weightsGb += fs.statSync(this.mmProjPath).size / 1e9
      } catch {
        /* unknown */
      }
      const { frac, reserveGb } = modeBudget(this.performanceMode)
      const rounded = computeSafeCtx({
        requested,
        totalGb,
        weightsGb,
        kvType: this.kvCacheType,
        frac,
        reserveGb
      })
      if (rounded < requested) {
        console.warn(
          `[LLMService] Clamping context ${requested} -> ${rounded} (RAM ${totalGb.toFixed(0)}GB, weights ${weightsGb.toFixed(1)}GB) to avoid memory overcommit`
        )
      }
      return rounded
    } catch {
      // If anything goes wrong reading sizes, fall back to a universally-safe value.
      return Math.min(requested, 8192)
    }
  }

  /** The EFFECTIVE (RAM-clamped) context window the server is actually running
   *  with — the real ceiling for prompt + tools + answer. */
  effectiveContextSize(): number {
    return this.safeCtxSize(this.ctxSize)
  }

  getSettings(): LlmSettings {
    return {
      temperature: this.temperature,
      ctxSize: this.ctxSize,
      topP: this.topP,
      topK: this.topK,
      minP: this.minP,
      repeatPenalty: this.repeatPenalty,
      maxTokens: this.maxTokens,
      systemPrompt: this.systemPrompt,
      kvCacheType: this.kvCacheType,
      flashAttn: this.flashAttn,
      gpuLayers: this.gpuLayers,
      threads: this.threads,
      batchSize: this.batchSize,
      performanceMode: this.performanceMode,
      // Report the EFFECTIVE (clamped) context so the UI can show what's really used.
      effectiveCtxSize: this.safeCtxSize(this.ctxSize)
    } as LlmSettings & { effectiveCtxSize: number }
  }

  /** The exact argv handed to `llama-server` for the CURRENT settings — the terminal
   *  artifact of the whole settings→persist→reload path. Delegates to the pure
   *  `buildLaunchArgs` (single source of truth) after applying the impure RAM clamp,
   *  so `_doInit` and tests build args the same way. */
  launchArgs(): string[] {
    return buildLaunchArgs({
      modelPath: this.modelPath,
      mmProjPath: this.mmProjPath,
      port: this.port,
      effectiveCtxSize: this.safeCtxSize(this.ctxSize),
      gpuLayers: this.gpuLayers,
      flashAttn: this.flashAttn,
      kvCacheType: this.kvCacheType,
      threads: this.threads,
      batchSize: this.batchSize
    })
  }

  /** Persist settings to disk. Writes the public settings PLUS the internal
   *  `userExplicit` pin-set (which fields the user set granularly), so a plain restart
   *  restores the pins and a mode preset can't reclobber an explicit KV/ctx choice. */
  private persist(): void {
    try {
      fs.writeFileSync(
        this.settingsFile,
        JSON.stringify({ ...this.getSettings(), userExplicit: [...this.userExplicit] })
      )
    } catch {
      /* ignore */
    }
  }

  /** Sampling params to merge into a request payload (only those the user set). */
  private samplingPayload(): Record<string, number> {
    return samplingPayload({
      topP: this.topP,
      topK: this.topK,
      minP: this.minP,
      repeatPenalty: this.repeatPenalty
    })
  }

  /** Read each image off disk and decode to base64 + mime (the one impure step of
   *  payload building). A file that can't be read is logged and skipped so a broken
   *  path never fails the whole request. */
  private decodeImages(images: string[]): DecodedImage[] {
    const out: DecodedImage[] = []
    for (const imgPath of images) {
      try {
        out.push({ base64: fs.readFileSync(imgPath).toString('base64'), mime: imageMime(imgPath) })
      } catch (readErr) {
        console.error(`[LLMService] Failed to read image ${imgPath}:`, readErr)
      }
    }
    return out
  }

  /** Update inference settings; respawns the server if any launch-time arg changed
   *  (context, KV-cache type, flash-attn, GPU layers, threads, batch). */
  async setSettings(s: LlmSettings): Promise<void> {
    // Granular launch-time fields the user sets in THIS patch become pinned: a mode
    // preset (now or on a future restart / mode re-pick) must NOT clobber them. Pin
    // BEFORE applying the preset so an explicit q8_0 in the same patch survives.
    if (s.kvCacheType === 'f16' || s.kvCacheType === 'q8_0' || s.kvCacheType === 'q4_0')
      this.userExplicit.add('kvCacheType')
    if (typeof s.flashAttn === 'boolean') this.userExplicit.add('flashAttn')
    if (typeof s.ctxSize === 'number') this.userExplicit.add('ctxSize')
    // A resource-usage mode change applies its preset by MERGING: it fills only the
    // preset fields the user has NOT pinned, so it can't wipe an explicit KV choice.
    // Always treated as a launch change.
    let modeChanged = false
    if (
      (s.performanceMode === 'conservative' ||
        s.performanceMode === 'balanced' ||
        s.performanceMode === 'extreme') &&
      s.performanceMode !== this.performanceMode
    ) {
      this.performanceMode = s.performanceMode
      const merged = applyModePreset(
        { ctxSize: this.ctxSize, kvCacheType: this.kvCacheType, flashAttn: this.flashAttn },
        s.performanceMode,
        this.userExplicit
      )
      this.ctxSize = merged.ctxSize
      this.kvCacheType = merged.kvCacheType
      this.flashAttn = merged.flashAttn
      modeChanged = true
    }
    // Launch-time args: changing any of these requires a server respawn.
    const launchChanged = launchArgsChanged(
      s,
      {
        ctxSize: this.ctxSize,
        kvCacheType: this.kvCacheType,
        flashAttn: this.flashAttn,
        gpuLayers: this.gpuLayers,
        threads: this.threads,
        batchSize: this.batchSize
      },
      modeChanged
    )
    if (typeof s.temperature === 'number') this.temperature = s.temperature
    if (typeof s.ctxSize === 'number') this.ctxSize = s.ctxSize
    if (typeof s.topP === 'number') this.topP = s.topP
    if (typeof s.topK === 'number') this.topK = s.topK
    if (typeof s.minP === 'number') this.minP = s.minP
    if (typeof s.repeatPenalty === 'number') this.repeatPenalty = s.repeatPenalty
    if (typeof s.maxTokens === 'number') this.maxTokens = s.maxTokens
    if (typeof s.systemPrompt === 'string') this.systemPrompt = s.systemPrompt
    if (s.kvCacheType === 'f16' || s.kvCacheType === 'q8_0' || s.kvCacheType === 'q4_0')
      this.kvCacheType = s.kvCacheType
    if (typeof s.flashAttn === 'boolean') this.flashAttn = s.flashAttn
    if (typeof s.gpuLayers === 'number') this.gpuLayers = s.gpuLayers
    if (typeof s.threads === 'number') this.threads = s.threads
    if (typeof s.batchSize === 'number') this.batchSize = s.batchSize
    // Quantized KV cache requires FlashAttention — auto-enable it so the pair is valid.
    if (this.kvCacheType !== 'f16' && !this.flashAttn) this.flashAttn = true
    this.persist()
    if (launchChanged && !this.paused) {
      this.stop()
      await this.init()
    }
  }

  // Resolve the active model's files. The Models screen writes active-model.json
  // ({ id, primary, mmproj }) after resolving a catalog entry; default to the
  // bundled Qwen3-VL vision model when nothing is selected yet.
  private resolveModel(): void {
    const modelsDir = getModelsDir()
    try {
      const cfg = JSON.parse(fs.readFileSync(this.activeModelFile, 'utf-8'))
      if (cfg?.primary) {
        this.modelPath = path.join(modelsDir, cfg.primary)
        this.mmProjPath = cfg.mmproj ? path.join(modelsDir, cfg.mmproj) : ''
        return
      }
    } catch {
      // no active selection yet
    }
    // No active selection yet. Point at a real catalog vision model so that IF
    // its files happen to be present we still load; otherwise modelsExist() is
    // false and setup ("Configure for me") downloads + activates a fitting model.
    // (The old default named a non-existent Qwen3-VL-4B and dead-ended fresh
    // installs at a 502 — never auto-resolvable. Keep this aligned with the catalog.)
    this.modelPath = path.join(modelsDir, 'gemma-4-E4B-it-Q4_K_M.gguf')
    this.mmProjPath = path.join(modelsDir, 'mmproj-gemma-4-E4B-it-F16.gguf')
  }

  /** Switch the active model and force a reload on next init. */
  reloadModel(): void {
    if (this.server) {
      this.intentionalStop = true // a model swap, not a crash
      this.server.kill()
      this.server = null
    }
    this.initialized = false
    this.restartTimes = [] // new model — start its crash budget fresh
    this.resolveModel()
  }

  // A model is "ready" once its PRIMARY weights are present. mmproj is optional —
  // it only adds image input; a vision model still runs text without it. (Gating
  // on mmproj wrongly kept "Setup Required" up for an activated vision model.)
  /** Whether the active chat model can read images (has a vision projector / mmproj). */
  hasVision(): boolean {
    this.resolveModel()
    return !!this.mmProjPath && fs.existsSync(this.mmProjPath)
  }

  modelsExist(): boolean {
    this.resolveModel()
    return fs.existsSync(this.modelPath)
  }

  getModelsDir(): string {
    return getModelsDir()
  }

  /** The active chat/vision model's id (catalog id if known, else the weight
   *  filename) and whether it has a vision projector — so the gateway's
   *  /v1/models can list the text model from disk even when the server hasn't
   *  loaded it yet (otherwise an idle/headless gateway reports no chat model).
   *  Returns null when no model is downloaded. */
  activeModelInfo(): { id: string; vision: boolean } | null {
    this.resolveModel()
    if (!fs.existsSync(this.modelPath)) return null
    let id = path.basename(this.modelPath)
    try {
      const cfg = JSON.parse(fs.readFileSync(this.activeModelFile, 'utf-8'))
      if (cfg?.id) id = cfg.id
    } catch {
      /* fall back to the filename */
    }
    return { id, vision: !!this.mmProjPath && fs.existsSync(this.mmProjPath) }
  }

  /** Cheap integrity check: a real GGUF starts with the "GGUF" magic and is more
   *  than a few bytes. Catches truncated/corrupt downloads before we hand the file
   *  to llama-server (which would otherwise crash on load). Delegates to the shared
   *  models/gguf implementation (single source of truth with models-manager). */
  private validateGguf(p: string): boolean {
    return isValidGgufFile(p, fs)
  }

  async init(): Promise<void> {
    if (this.paused) {
      // A chat/tool turn needs the LLM NOW, but it's paused for a resident image
      // server (unified memory can't hold both). Ask the image server to evict
      // on-demand — freeing its memory and flipping `paused` off via its eviction
      // hook — instead of making the caller wait out the ~60s idle timer. Then
      // clear the pause ourselves as a safety net so init NEVER silently no-ops
      // and leaves chat without a server (the bug this replaces).
      try {
        this.resumeFromPauseHook?.()
      } catch {
        /* ignore */
      }
      this.paused = false
    }
    if (this.initialized) return
    // Coalesce concurrent inits into one spawn.
    if (this.initPromise !== null) return this.initPromise
    this.initPromise = this._doInit().finally(() => {
      this.initPromise = null
    })
    return this.initPromise
  }

  private async _doInit() {
    if (this.initialized) return

    this.resolveModel()

    // Check if models exist
    if (!this.modelsExist()) {
      console.error(`[LLMService] Models not found. Please download them first.`)
      console.error(`[LLMService] Expected model: ${this.modelPath}`)
      console.error(`[LLMService] Expected mmproj: ${this.mmProjPath}`)
      throw new Error('Models not downloaded. Please complete onboarding to download the AI model.')
    }

    // Integrity check: a corrupt/truncated weights file would crash llama-server
    // on load. Fail with a clear message so the UI can prompt a re-download.
    if (!this.validateGguf(this.modelPath)) {
      console.error(
        `[LLMService] Model file failed GGUF validation (corrupt/truncated): ${this.modelPath}`
      )
      throw new Error(
        'The model file looks corrupt or incomplete. Re-download it from the Models screen.'
      )
    }
    // mmproj is optional — if it's corrupt, drop it (text still works) rather than fail.
    if (this.mmProjPath && !this.validateGguf(this.mmProjPath)) {
      console.warn(`[LLMService] mmproj failed validation; loading text-only: ${this.mmProjPath}`)
      this.mmProjPath = ''
    }

    // ONE engine: bin/llama/llama-server, built in CI from source with a pinned
    // macOS deployment target (scripts/build-llama.sh) so it both supports the
    // newest model archs (gemma4/qwen35) AND runs on macOS 13+. The old dual-
    // engine setup shipped a second, older binary as a "fallback" that silently
    // couldn't load those models — removed.
    // Engines to try, IN ORDER. On Windows we ship a Vulkan (GPU) build in
    // bin/llama and a CPU-only fallback in bin/llama-cpu: if the Vulkan server
    // can't start (e.g. no Vulkan loader on the box) we fall through to CPU. On
    // macOS/Linux only bin/llama exists, so this is a single-entry list and the
    // behaviour is unchanged.
    const roots = binRoots()
    const serverPaths = roots
      .flatMap((r) => [
        path.join(r, 'llama', exe('llama-server')),
        path.join(r, 'llama-cpu', exe('llama-server')),
        path.join(r, exe('llama-server'))
      ])
      .filter((p) => fs.existsSync(p))
    if (!serverPaths.length) {
      console.error(`[LLMService] llama-server binary not found under: ${roots.join(', ')}`)
      return
    }

    console.log(`[LLMService] Model: ${this.modelPath}`)

    // launchArgs() (settings-math buildLaunchArgs) is the single source of truth for
    // the llama-server launch args — ctx/ngl/flash-attn/kv-cache/threads/batch. The
    // per-engine quarantine strip + binDir live in launchServer() below.
    const args = this.launchArgs()
    // Kill any lingering server before spawning (defends against a crashed or
    // orphaned instance still holding the port / RAM).
    if (this.server) {
      try {
        this.server.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      this.server = null
    }
    // ALSO kill an ORPHANED server from a previous app process — when the app
    // restarts, the old llama-server keeps holding the port, so a new spawn can't
    // bind and config changes (ctx size, model) silently never take effect. Worse,
    // waitForReady would then talk to the ORPHAN (which may serve no/stale model),
    // marking us "ready" with an empty /v1/models. Find whatever owns the port
    // and kill it first.
    if (this.killOrphansOnPort(this.port) > 0) {
      await new Promise((r) => setTimeout(r, 400)) // let the port free
    }

    for (let i = 0; i < serverPaths.length; i++) {
      const serverPath = serverPaths[i]
      if (!serverPath) continue
      if (await this.launchServer(serverPath, args)) return // ready
      if (i < serverPaths.length - 1) {
        console.warn(`[LLMService] engine at ${serverPath} failed to start; trying fallback engine`)
        // launchServer already tore its process down; free the port before retry.
        if (this.killOrphansOnPort(this.port) > 0) await new Promise((r) => setTimeout(r, 400))
      }
    }
    console.error('[LLMService] all llama-server engines failed to start')
  }

  /** Spawn ONE llama-server binary and wait until the model is loaded. Returns
   *  true when it's ready, false when it fails to start — so _doInit can fall
   *  through to the next engine (Windows Vulkan -> CPU). A failed process is torn
   *  down with its close handler neutralized so it can't trigger a crash-restart. */
  private async launchServer(serverPath: string, args: string[]): Promise<boolean> {
    const binDir = path.dirname(serverPath)
    console.log(`[LLMService] Starting llama-server from ${serverPath}`)
    // Strip macOS quarantine attributes on production builds (downloaded DMGs get quarantined)
    if (isPackaged() && process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${binDir}"`, { stdio: 'ignore' })
        execSync(`chmod +x "${serverPath}"`, { stdio: 'ignore' })
        console.log('[LLMService] Cleared quarantine attributes from bin directory')
      } catch (e) {
        console.warn('[LLMService] Could not clear quarantine attributes:', e)
      }
    }

    let proc: ChildProcess
    try {
      proc = spawn(serverPath, args, {
        env: {
          ...process.env,
          // macOS: rpath for the co-located dylibs. Windows: the loader already
          // searches the exe's own dir for DLLs, but prepend binDir to PATH so the
          // ggml/llama DLLs resolve even if that behaviour is restricted.
          DYLD_LIBRARY_PATH: binDir,
          ...(process.platform === 'win32'
            ? { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` }
            : {})
        }
      })
    } catch (e) {
      console.error(`[LLMService] failed to spawn ${serverPath}:`, e)
      return false
    }
    // Stop intent belongs to the process generation that was killed. A replacement
    // child must start clean, otherwise its later genuine crash is misclassified as
    // deliberate and auto-recovery is skipped.
    this.intentionalStop = false
    this.server = proc
    this.stderrTail = []
    let abandoned = false // set when we give up on this proc so its close handler is inert

    // A spawn/load error (e.g. a missing Vulkan loader on Windows) surfaces here;
    // swallow it (waitForReady will fail and we fall back) so it isn't unhandled.
    proc.on('error', (e) => {
      console.error(`[LLMService] llama-server process error:`, e)
    })

    proc.stderr?.on('data', (data) => {
      const text = String(data)
      console.log(`[llama-server] ${text}`)
      // Keep a rolling tail so we can classify a load failure after it exits.
      for (const line of text.split(/\r?\n/)) if (line.trim()) this.stderrTail.push(line)
      if (this.stderrTail.length > 50) this.stderrTail = this.stderrTail.slice(-50)
    })

    proc.on('close', (code, signal) => {
      console.log(`[llama-server] exited with code ${code} signal ${signal}`)
      // Ignore the close of a PROCESS WE'VE ALREADY REPLACED (restart/reload) or
      // one we deliberately abandoned during engine fallback.
      if (this.server !== proc || abandoned) return
      const wasIntentional = this.intentionalStop
      this.intentionalStop = false
      this.server = null
      this.initialized = false
      // If it died on its own (not our stop/swap), translate the stderr into a
      // human reason so the Health panel can say WHY instead of a blank "Down".
      const deliberateClose = wasIntentional || signal === 'SIGKILL' || signal === 'SIGTERM'
      if (!deliberateClose && !this.paused) {
        const failure = classifyLlamaError(this.stderrTail.join('\n'))
        if (failure) {
          this.lastErrorMsg = failure.reason
          console.error(
            `[LLMService] llama-server load failure (${failure.code}): ${failure.reason}`
          )
        }
      }
      // Do NOT auto-restart a DELIBERATE kill — a user/OS `kill` (SIGKILL/SIGTERM)
      // or our own teardown. Otherwise killing llama-server just respawns it,
      // making it impossible to stop without killing the whole app. Only recover
      // from a genuine crash (non-zero code / SIGABRT) we didn't initiate.
      const deliberate = signal === 'SIGKILL' || signal === 'SIGTERM'
      if (!wasIntentional && !this.paused && !deliberate) this.handleCrash(code ?? -1)
    })

    try {
      await this.waitForReady()
      console.log('[LLMService] Vision server ready!')
      this.initialized = true
      this.lastErrorMsg = null // healthy again — clear any prior failure reason
      return true
    } catch (e) {
      console.error(`[LLMService] engine at ${binDir} failed to start:`, e)
      // Tear down WITHOUT going through stop() (which sets intentionalStop and
      // would suppress crash-recovery for the NEXT engine). Neutralize this
      // proc's close handler so the fallback isn't misread as a crash.
      abandoned = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      if (this.server === proc) {
        this.server = null
        this.initialized = false
      }
      return false
    }
  }

  /** Guard shared by every generation entry point: reject while paused, lazily
   *  init, and fail loudly if init didn't take. Single source of truth so the
   *  three chat methods don't each re-implement it. */
  private async ensureReady(): Promise<void> {
    if (this.paused) throw new Error('LLM paused during image generation — deferred')
    if (!this.initialized) {
      await this.init()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- init() flips `initialized` across the await; TS narrows the field to its pre-await `false` and can't see the mutation.
      if (!this.initialized) throw new Error('LLM Service not ready')
    }
  }

  // Kill an orphaned llama-server still holding our port (from a crashed/previous app
  // process). Delegates to the shared cross-platform reaper (kill-orphan-port.ts) —
  // matched by name so we only ever kill a llama-server, never an unrelated app that
  // happened to bind the port.
  private killOrphansOnPort(port: number): number {
    return reapOrphansOnPort(port, (c) => /llama-server/i.test(c), 'llama-server')
  }

  /** Auto-recover from an unexpected llama-server crash. Backs off, and on repeated
   *  crashes shrinks the context (the usual culprit is memory pressure) before
   *  retrying. Gives up after a few attempts so we never spin forever. */
  private async handleCrash(code: number): Promise<void> {
    // Rolling 2-minute window: if it has already died 3× recently, STOP recovering.
    // Prevents thrash-respawning a multi-GB process when the model is too heavy for
    // the machine (memory-pressure kills). Surface it; the user can pick a smaller
    // model / Conservative mode or hit Health → Restart.
    const now = Date.now()
    this.restartTimes = this.restartTimes.filter((t) => now - t < 120_000)
    if (this.restartTimes.length >= 3) {
      console.error(
        `[LLMService] llama-server died ${this.restartTimes.length + 1}× in 2min (last code ${code}); NOT auto-restarting — likely memory pressure. Pick a smaller model or Conservative mode.`
      )
      return
    }
    this.restartTimes.push(now)
    // On a repeat death in the window, halve the context — usually OOM/overcommit.
    if (this.restartTimes.length >= 2) {
      const reduced = Math.max(2048, Math.floor(this.ctxSize / 2 / 1024) * 1024)
      if (reduced < this.ctxSize) {
        console.warn(
          `[LLMService] reducing context ${this.ctxSize} -> ${reduced} after repeated crashes`
        )
        this.ctxSize = reduced
        this.persist()
      }
    }
    await new Promise((r) => setTimeout(r, 1000 * this.restartTimes.length))
    if (this.paused || this.intentionalStop) return
    console.log(`[LLMService] auto-restarting llama-server (attempt ${this.restartTimes.length})`)
    this.init().catch(() => {})
  }

  // Ready = the model is actually LOADED, not merely that the server answers.
  // /health can report OK before the weights finish loading, and an orphan server
  // on this port would answer /health while serving NO model — which surfaced as
  // a 200 server with an empty /v1/models. So we additionally require /v1/models
  // to list a model before declaring ready, and we bail immediately if the server
  // process exits (a model that fails to load takes the process down with it).
  private async waitForReady(timeout = 60000): Promise<void> {
    const start = Date.now()
    let healthOk = false
    while (Date.now() - start < timeout) {
      // The server died during startup (e.g. model load failure) — stop waiting.
      if (!this.server) throw new Error('llama-server exited during startup — model failed to load')
      try {
        if (!healthOk) {
          const res = await fetch(`http://127.0.0.1:${this.port}/health`)
          healthOk = res.ok
        }
        if (healthOk) {
          const res = await fetch(`http://127.0.0.1:${this.port}/v1/models`)
          if (res.ok) {
            const body = await res.json().catch(() => null)
            if (Array.isArray(body?.data) && body.data.length > 0) return
          }
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('Server started but no model was loaded within the timeout')
  }

  // Use Node http module instead of fetch to avoid undici's headersTimeout (300s)
  // which kills long-running LLM requests before they can respond. Delegates to the
  // electron-free postCompletionOnce so the fresh-connection contract lives in one place
  // (see llm/http-post.ts) and is integration-tested against a real socket-closing server.
  private httpPost(body: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return postCompletionOnce(this.port, body, timeoutMs, signal)
  }

  async chat(
    message: string,
    images: string[] = [],
    timeoutMs: number = 300000,
    maxTokens?: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: {
      responseFormat?: any
      temperature?: number
      disableThinking?: boolean
      signal?: AbortSignal
    } = {}
  ): Promise<string> {
    await this.ensureReady()

    return this.chatMutex.runExclusive(async () => {
      try {
        const messages = buildMessages(message, this.decodeImages(images), this.systemPrompt)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = {
          messages: messages,
          max_tokens: resolveMaxTokens(maxTokens, this.maxTokens),
          temperature: opts.temperature ?? this.temperature,
          ...this.samplingPayload()
        }
        // Grammar-constrained output: llama.cpp converts the JSON schema to a
        // GBNF grammar so the model can ONLY emit valid matching JSON.
        if (opts.responseFormat) payload.response_format = opts.responseFormat
        // Turn off the model's reasoning channel for fast, direct output (its
        // chain-of-thought otherwise eats the token budget and leaves content empty).
        if (opts.disableThinking) payload.chat_template_kwargs = { enable_thinking: false }
        const body = JSON.stringify(payload)

        console.log(
          `[LLMService] Starting LLM request (timeout: ${timeoutMs / 1000}s, body: ${body.length} chars)...`
        )

        const raw = await this.httpPost(body, timeoutMs, opts.signal)
        const data = JSON.parse(raw)
        console.log('[LLMService] LLM request completed')
        // Best-effort fleet audit: record the local model call if enrolled in a
        // console. The fleet console is a pro feature — it registers this hook in
        // its activation; the free build has no hook and this is a no-op.
        try {
          const tokens = data.usage?.total_tokens ?? 0
          const modelName = path.basename(this.modelPath) || 'local-llm'
          callHook('console.recordModelCall', modelName, tokens, 'ok', false)
        } catch {
          /* audit is never load-bearing */
        }
        return data.choices?.[0]?.message?.content ?? ''
      } catch (e: any) {
        console.error('[LLMService] Chat error:', e.message || e)
        throw e
      }
    })
  }

  // Streaming variant of chat(): posts with stream:true and invokes `onDelta`
  // for each token as it arrives. Separates the model's reasoning channel
  // (delta.reasoning_content, or text inside <think>…</think>) from the answer
  // (delta.content). Returns the full answer text when the stream ends.
  async chatStream(
    message: string,
    images: string[] = [],
    onDelta: (text: string, kind: 'content' | 'reasoning') => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: { temperature?: number; thinking?: boolean; signal?: AbortSignal } = {},
    maxTokens?: number,
    timeoutMs: number = 300000
  ): Promise<string> {
    await this.ensureReady()

    const messages = buildMessages(message, this.decodeImages(images), this.systemPrompt)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      messages,
      max_tokens: resolveMaxTokens(maxTokens, this.maxTokens),
      temperature: opts.temperature ?? this.temperature,
      ...this.samplingPayload(),
      stream: true,
      // Thinking control: when on, ask the template to emit reasoning and have
      // llama.cpp split it into reasoning_content (deepseek-style); when off,
      // suppress it so the token budget goes to the answer.
      ...thinkingPayload(!!opts.thinking)
    }
    const body = JSON.stringify(payload)

    // Single SSE transport (llm/stream.ts). The plain chat path sends no tools, so
    // the returned toolCalls are always empty — take only the answer text.
    const { content } = await streamCompletion(this.port, body, onDelta, {
      signal: opts.signal,
      timeoutMs
    })
    return content
  }

  // Lower-level streaming turn over a RAW messages array with optional tool-calling.
  // Powers the agentic tool loop (tools.ts): streams reasoning + answer via `onDelta`
  // (same channels as chatStream) AND accumulates any tool_calls the model emits, so a
  // tools turn streams thinking -> (the loop surfaces the tool step) -> the answer, all
  // through one path. Returns the streamed answer text + the assembled tool calls for
  // this round (empty when the model answered instead of calling a tool).
  async streamChat(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    onDelta: (text: string, kind: 'content' | 'reasoning') => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: {
      temperature?: number
      thinking?: boolean
      signal?: AbortSignal
      tools?: unknown[]
      toolChoice?: string
      maxTokens?: number
    } = {},
    timeoutMs: number = 300000
  ): Promise<{ content: string; toolCalls: AssembledToolCall[] }> {
    await this.ensureReady()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      messages,
      max_tokens: resolveMaxTokens(opts.maxTokens, this.maxTokens),
      temperature: opts.temperature ?? this.temperature,
      ...this.samplingPayload(),
      stream: true,
      ...thinkingPayload(!!opts.thinking)
    }
    if (opts.tools && opts.tools.length) {
      payload.tools = opts.tools
      payload.tool_choice = opts.toolChoice ?? 'auto'
    }
    const body = JSON.stringify(payload)

    // Single SSE transport (llm/stream.ts) — same path as chatStream, but the
    // assembled tool calls are surfaced too (this powers the agentic loop).
    return streamCompletion(this.port, body, onDelta, { signal: opts.signal, timeoutMs })
  }

  stop() {
    if (this.server) {
      this.intentionalStop = true // deliberate shutdown — don't auto-restart
      this.server.kill()
      this.server = null
      this.initialized = false
    }
  }

  /** Set by the image runtime (imagegen.ts): how to evict a resident image server
   *  when a chat/tool turn needs the LLM back while it's paused. Kept as a hook so
   *  this module never imports the image runtime (layering). */
  private resumeFromPauseHook: (() => void) | null = null
  setResumeFromPauseHook(fn: () => void) {
    this.resumeFromPauseHook = fn
  }

  /** Pause for image generation: free the server and block respawns until resumed. */
  pause() {
    this.paused = true
    this.stop()
  }

  /** Resume after image generation and warm the server back up (resident mode). */
  resume() {
    this.paused = false
    this.init().catch(() => {})
  }

  /** Clear the pause block WITHOUT warming the server (on-demand mode). The server
   *  stays down and lazily respawns on the next chat/tool turn, freeing its RAM in
   *  the meantime. Pairs with pause() as the on-demand counterpart of resume(). */
  releasePause() {
    this.paused = false
  }

  /** This engine as a ManagedRuntime for the shared residency seam (runtime-manager),
   *  so the chat model is managed identically to image/STT/TTS — one code path. */
  get runtime(): ManagedRuntime {
    return {
      modality: 'llm',
      evict: () => {
        try {
          this.pause()
        } catch {
          /* ignore */
        }
      },
      warm: () => {
        this.resume()
      },
      release: () => {
        this.releasePause()
      }
    }
  }

  isReady() {
    return this.initialized
  }

  /** True when the server process is alive but the model hasn't finished loading
   *  yet — the normal several-second warm-up (gemma-4 at -ngl 99 isn't instant).
   *  Lets Health show "Loading model…" instead of a scary "server is not running"
   *  during a cold start. */
  isStarting() {
    return this.server !== null && !this.initialized
  }

  /** Human, actionable reason the chat server failed to start (null when healthy
   *  or never failed). Surfaced in the Health panel so "Down" explains itself. */
  lastError(): string | null {
    return this.lastErrorMsg
  }

  /** Hard restart: kill the server and spawn it fresh (picks up a model swap or
   *  recovers a crashed/hung instance). Used by "Configure for me", the Health
   *  panel's restart action, and the Models screen dev control. Clears `paused`
   *  so a manual restart always recovers even while paused for image gen, and
   *  throws if the server fails to come back up so the caller can surface it. */
  async restart(): Promise<void> {
    this.paused = false
    this.stop()
    this.initialized = false
    this.resolveModel()
    await this.init()
    // init() mutates `initialized` across an await; TypeScript cannot observe that
    // mutation and incorrectly treats this runtime failure guard as redundant.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.initialized)
      throw new Error('Server did not come back up — check the model is downloaded')
  }
}

export const llm = new LLMService()

onHostQuit(() => {
  llm.stop()
})
