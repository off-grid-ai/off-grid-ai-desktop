import { spawn, execSync, ChildProcess } from "child_process";
import os from "os";
import { Mutex } from "async-mutex";
import { callHook } from "./bootstrap/hookRegistry";
import path from "path";
import * as fs from "fs";
import * as http from "http";
import { modelsDir as getModelsDir, binRoots, isPackaged, onHostQuit } from "./runtime-env";
import { computeSafeCtx, modeBudget, type KvCacheType, type PerformanceMode } from "./model-sizing";
import { classifyLlamaError } from "./llama-error";

export type { KvCacheType, PerformanceMode };

// Friendly presets that decide how much of the machine the local model uses.
// Conservative leaves lots of headroom (safest on small / busy machines);
// Extreme pushes context/memory for max capability. The RAM clamp still applies
// on top, so even Extreme can't overcommit into a freeze.
// Context is a CEILING, not a fill-the-RAM target: a big context means a big KV
// cache (the bulk of llama-server's memory), so defaults stay modest. Conservative
// also quantizes the KV cache (q8_0) to roughly halve it. Users who want more can
// raise context or pick Extreme.
const MODE_PRESETS: Record<PerformanceMode, { ctxSize: number; kvCacheType: KvCacheType; flashAttn: boolean }> = {
  conservative: { ctxSize: 8192, kvCacheType: "q8_0", flashAttn: true },
  balanced: { ctxSize: 16384, kvCacheType: "f16", flashAttn: false },
  extreme: { ctxSize: 65536, kvCacheType: "f16", flashAttn: false },
};

export interface LlmSettings {
  performanceMode?: PerformanceMode;
  temperature?: number;
  ctxSize?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // Launch-time (require a server respawn to take effect):
  kvCacheType?: KvCacheType; // quantize the KV cache to cut memory (needs flash-attn)
  flashAttn?: boolean;       // FlashAttention: faster + lower memory; required for quantized KV
  gpuLayers?: number;        // -ngl: layers offloaded to GPU (Metal). 99 = all.
  threads?: number;          // CPU threads for inference
  batchSize?: number;        // -b: prompt batch size
}

export class LLMService {
  private server: ChildProcess | null = null;
  // Off the contested 8080 (collides with other local dev servers) onto a
  // less-trafficked port so the model server reliably binds.
  private port = 8439;
  // Single-flight init guard: concurrent chat() calls (e.g. the capture
  // extractor firing rapidly) must share ONE spawn, not each launch a server.
  private initPromise: Promise<void> | null = null;
  private modelPath = "";
  private mmProjPath = ""; // empty for text-only models (no vision projector)
  private initialized = false;
  // Paused during image generation: on Apple Silicon unified memory the LLM and
  // the image model can't both be resident. While paused we DON'T respawn the
  // server — capture keeps running but its LLM distillation is deferred until
  // generation finishes (and the LLM warms back up).
  private paused = false;
  // Resolve lazily: the data dir can be set AFTER this class is constructed
  // (e.g. an OFFGRID_USER_DATA / standalone-gateway override), so computing the
  // path at construction would pin it to the wrong location and miss active-model.json.
  private get activeModelFile(): string { return path.join(getModelsDir(), "active-model.json"); }
  // User-tunable inference settings (persisted). Context window needs a server
  // respawn to take effect (it's a launch arg); temperature is per-request.
  private temperature = 0.7;
  private ctxSize = 16384; // modest default — context is a ceiling, not a fill-RAM target (KV cache is the bulk of memory). Raise it or use Extreme for more.
  // ONE local gemma server, but many callers (capture distill, day-plan, the
  // secretary, action extraction…). Concurrent requests contend and time out.
  // Serialize them so each gets the server to itself; the per-call timeout sits
  // INSIDE the lock, so it measures execution, not time spent waiting in line.
  private chatMutex = new Mutex();
  // Advanced sampling (LM Studio-style). undefined = let llama.cpp use its default.
  private topP: number | undefined;
  private topK: number | undefined;
  private minP: number | undefined;
  private repeatPenalty: number | undefined;
  private maxTokens = 2048;
  private systemPrompt = '';
  // Resource-usage preset. Governs the RAM budget the context clamp targets and
  // the default ctx/KV preset. 'balanced' preserves prior behavior.
  private performanceMode: PerformanceMode = "balanced";
  // Launch-time params (need a respawn). Defaults match prior hardcoded behavior.
  private kvCacheType: KvCacheType = "f16";
  private flashAttn = false;
  private gpuLayers = 99;
  private threads: number | undefined;
  private batchSize: number | undefined;
  // Crash recovery: distinguish an intentional kill (stop/reload/settings respawn)
  // from an unexpected crash so we only auto-restart on real crashes.
  private intentionalStop = false;
  // Timestamps of recent auto-restarts. A rolling 2-minute window caps recovery so
  // a server that keeps dying (e.g. memory pressure on a too-large model) can NOT
  // thrash-respawn a multi-GB process forever.
  private restartTimes: number[] = [];
  // Last ~50 stderr lines from llama-server, so we can explain WHY it died on
  // load (unknown arch / OOM / OS-too-old) instead of a blank "Down".
  private stderrTail: string[] = [];
  // Human, actionable reason the server failed to come up (null when healthy).
  private lastErrorMsg: string | null = null;
  private get settingsFile(): string { return path.join(getModelsDir(), "llm-settings.json"); }

  constructor() {
    this.resolveModel();
    try {
      const s = JSON.parse(fs.readFileSync(this.settingsFile, "utf-8"));
      if (typeof s.temperature === "number") this.temperature = s.temperature;
      if (typeof s.ctxSize === "number") this.ctxSize = s.ctxSize;
      if (typeof s.topP === "number") this.topP = s.topP;
      if (typeof s.topK === "number") this.topK = s.topK;
      if (typeof s.minP === "number") this.minP = s.minP;
      if (typeof s.repeatPenalty === "number") this.repeatPenalty = s.repeatPenalty;
      if (typeof s.maxTokens === "number") this.maxTokens = s.maxTokens;
      if (typeof s.systemPrompt === "string") this.systemPrompt = s.systemPrompt;
      if (s.kvCacheType === "f16" || s.kvCacheType === "q8_0" || s.kvCacheType === "q4_0") this.kvCacheType = s.kvCacheType;
      if (typeof s.flashAttn === "boolean") this.flashAttn = s.flashAttn;
      if (typeof s.gpuLayers === "number") this.gpuLayers = s.gpuLayers;
      if (typeof s.threads === "number") this.threads = s.threads;
      if (typeof s.batchSize === "number") this.batchSize = s.batchSize;
      if (s.performanceMode === "conservative" || s.performanceMode === "balanced" || s.performanceMode === "extreme") this.performanceMode = s.performanceMode;
    } catch { /* defaults */ }
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
      const totalGb = os.totalmem() / 1e9;
      let weightsGb = 0;
      try { weightsGb += fs.statSync(this.modelPath).size / 1e9; } catch { /* unknown */ }
      try { if (this.mmProjPath) weightsGb += fs.statSync(this.mmProjPath).size / 1e9; } catch { /* unknown */ }
      const { frac, reserveGb } = modeBudget(this.performanceMode);
      const rounded = computeSafeCtx({ requested, totalGb, weightsGb, kvType: this.kvCacheType, frac, reserveGb });
      if (rounded < requested) {
        console.warn(`[LLMService] Clamping context ${requested} -> ${rounded} (RAM ${totalGb.toFixed(0)}GB, weights ${weightsGb.toFixed(1)}GB) to avoid memory overcommit`);
      }
      return rounded;
    } catch {
      // If anything goes wrong reading sizes, fall back to a universally-safe value.
      return Math.min(requested, 8192);
    }
  }

  getSettings(): LlmSettings {
    return {
      temperature: this.temperature, ctxSize: this.ctxSize,
      topP: this.topP, topK: this.topK, minP: this.minP,
      repeatPenalty: this.repeatPenalty, maxTokens: this.maxTokens,
      systemPrompt: this.systemPrompt,
      kvCacheType: this.kvCacheType, flashAttn: this.flashAttn,
      gpuLayers: this.gpuLayers, threads: this.threads, batchSize: this.batchSize,
      performanceMode: this.performanceMode,
      // Report the EFFECTIVE (clamped) context so the UI can show what's really used.
      effectiveCtxSize: this.safeCtxSize(this.ctxSize),
    } as LlmSettings & { effectiveCtxSize: number };
  }

  /** Sampling params to merge into a request payload (only those the user set). */
  private samplingPayload(): Record<string, number> {
    const p: Record<string, number> = {};
    if (typeof this.topP === "number") p.top_p = this.topP;
    if (typeof this.topK === "number") p.top_k = this.topK;
    if (typeof this.minP === "number") p.min_p = this.minP;
    if (typeof this.repeatPenalty === "number") p.repeat_penalty = this.repeatPenalty;
    return p;
  }

  /** Update inference settings; respawns the server if any launch-time arg changed
   *  (context, KV-cache type, flash-attn, GPU layers, threads, batch). */
  async setSettings(s: LlmSettings): Promise<void> {
    // A resource-usage mode change applies its preset first (explicit fields in the
    // same patch still override it below). Always treated as a launch change.
    let modeChanged = false;
    if ((s.performanceMode === "conservative" || s.performanceMode === "balanced" || s.performanceMode === "extreme") && s.performanceMode !== this.performanceMode) {
      this.performanceMode = s.performanceMode;
      const p = MODE_PRESETS[s.performanceMode];
      this.ctxSize = p.ctxSize; this.kvCacheType = p.kvCacheType; this.flashAttn = p.flashAttn;
      modeChanged = true;
    }
    // Launch-time args: changing any of these requires a server respawn.
    const launchChanged = modeChanged ||
      (typeof s.ctxSize === "number" && s.ctxSize !== this.ctxSize) ||
      (s.kvCacheType !== undefined && s.kvCacheType !== this.kvCacheType) ||
      (typeof s.flashAttn === "boolean" && s.flashAttn !== this.flashAttn) ||
      (typeof s.gpuLayers === "number" && s.gpuLayers !== this.gpuLayers) ||
      (typeof s.threads === "number" && s.threads !== this.threads) ||
      (typeof s.batchSize === "number" && s.batchSize !== this.batchSize);
    if (typeof s.temperature === "number") this.temperature = s.temperature;
    if (typeof s.ctxSize === "number") this.ctxSize = s.ctxSize;
    if (typeof s.topP === "number") this.topP = s.topP;
    if (typeof s.topK === "number") this.topK = s.topK;
    if (typeof s.minP === "number") this.minP = s.minP;
    if (typeof s.repeatPenalty === "number") this.repeatPenalty = s.repeatPenalty;
    if (typeof s.maxTokens === "number") this.maxTokens = s.maxTokens;
    if (typeof s.systemPrompt === "string") this.systemPrompt = s.systemPrompt;
    if (s.kvCacheType === "f16" || s.kvCacheType === "q8_0" || s.kvCacheType === "q4_0") this.kvCacheType = s.kvCacheType;
    if (typeof s.flashAttn === "boolean") this.flashAttn = s.flashAttn;
    if (typeof s.gpuLayers === "number") this.gpuLayers = s.gpuLayers;
    if (typeof s.threads === "number") this.threads = s.threads;
    if (typeof s.batchSize === "number") this.batchSize = s.batchSize;
    // Quantized KV cache requires FlashAttention — auto-enable it so the pair is valid.
    if (this.kvCacheType !== "f16" && !this.flashAttn) this.flashAttn = true;
    try { fs.writeFileSync(this.settingsFile, JSON.stringify(this.getSettings())); } catch { /* ignore */ }
    if (launchChanged && !this.paused) {
      this.stop();
      await this.init();
    }
  }

  // Resolve the active model's files. The Models screen writes active-model.json
  // ({ id, primary, mmproj }) after resolving a catalog entry; default to the
  // bundled Qwen3-VL vision model when nothing is selected yet.
  private resolveModel(): void {
    const modelsDir = getModelsDir();
    try {
      const cfg = JSON.parse(fs.readFileSync(this.activeModelFile, "utf-8"));
      if (cfg?.primary) {
        this.modelPath = path.join(modelsDir, cfg.primary);
        this.mmProjPath = cfg.mmproj ? path.join(modelsDir, cfg.mmproj) : "";
        return;
      }
    } catch {
      // no active selection yet
    }
    // No active selection yet. Point at a real catalog vision model so that IF
    // its files happen to be present we still load; otherwise modelsExist() is
    // false and setup ("Configure for me") downloads + activates a fitting model.
    // (The old default named a non-existent Qwen3-VL-4B and dead-ended fresh
    // installs at a 502 — never auto-resolvable. Keep this aligned with the catalog.)
    this.modelPath = path.join(modelsDir, "gemma-4-E4B-it-Q4_K_M.gguf");
    this.mmProjPath = path.join(modelsDir, "mmproj-gemma-4-E4B-it-F16.gguf");
  }

  /** Switch the active model and force a reload on next init. */
  reloadModel(): void {
    if (this.server) {
      this.intentionalStop = true; // a model swap, not a crash
      this.server.kill();
      this.server = null;
    }
    this.initialized = false;
    this.restartTimes = []; // new model — start its crash budget fresh
    this.resolveModel();
  }

  // A model is "ready" once its PRIMARY weights are present. mmproj is optional —
  // it only adds image input; a vision model still runs text without it. (Gating
  // on mmproj wrongly kept "Setup Required" up for an activated vision model.)
  /** Whether the active chat model can read images (has a vision projector / mmproj). */
  hasVision(): boolean {
    this.resolveModel();
    return !!this.mmProjPath && fs.existsSync(this.mmProjPath);
  }

  modelsExist(): boolean {
    this.resolveModel();
    return fs.existsSync(this.modelPath);
  }

  getModelsDir(): string {
    return getModelsDir();
  }

  /** Cheap integrity check: a real GGUF starts with the "GGUF" magic and is more
   *  than a few bytes. Catches truncated/corrupt downloads before we hand the file
   *  to llama-server (which would otherwise crash on load). */
  private validateGguf(p: string): boolean {
    try {
      if (fs.statSync(p).size < 1024) return false;
      const fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      return buf.toString("ascii") === "GGUF";
    } catch { return false; }
  }

  async init(): Promise<void> {
    if (this.paused) return; // don't respawn while paused for image generation
    if (this.initialized) return;
    // Coalesce concurrent inits into one spawn.
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async _doInit() {
    if (this.initialized) return;

    this.resolveModel();

    // Check if models exist
    if (!this.modelsExist()) {
      console.error(`[LLMService] Models not found. Please download them first.`);
      console.error(`[LLMService] Expected model: ${this.modelPath}`);
      console.error(`[LLMService] Expected mmproj: ${this.mmProjPath}`);
      throw new Error("Models not downloaded. Please complete onboarding to download the AI model.");
    }

    // Integrity check: a corrupt/truncated weights file would crash llama-server
    // on load. Fail with a clear message so the UI can prompt a re-download.
    if (!this.validateGguf(this.modelPath)) {
      console.error(`[LLMService] Model file failed GGUF validation (corrupt/truncated): ${this.modelPath}`);
      throw new Error("The model file looks corrupt or incomplete. Re-download it from the Models screen.");
    }
    // mmproj is optional — if it's corrupt, drop it (text still works) rather than fail.
    if (this.mmProjPath && !this.validateGguf(this.mmProjPath)) {
      console.warn(`[LLMService] mmproj failed validation; loading text-only: ${this.mmProjPath}`);
      this.mmProjPath = "";
    }

    // ONE engine: bin/llama/llama-server, built in CI from source with a pinned
    // macOS deployment target (scripts/build-llama.sh) so it both supports the
    // newest model archs (gemma4/qwen35) AND runs on macOS 13+. The old dual-
    // engine setup shipped a second, older binary as a "fallback" that silently
    // couldn't load those models — removed.
    const roots = binRoots();
    const candidates = roots.map((r) => path.join(r, "llama", "llama-server"));
    const serverPath = candidates.find((p) => fs.existsSync(p)) ?? "";
    if (!serverPath) {
        console.error(`[LLMService] llama-server binary not found. Looked in:\n${candidates.join("\n")}`);
        return;
    }

    console.log(`[LLMService] Starting llama-server from ${serverPath}`);
    console.log(`[LLMService] Model: ${this.modelPath}`);

    // Strip macOS quarantine attributes on production builds (downloaded DMGs get quarantined)
    if (isPackaged() && process.platform === 'darwin') {
        try {
            const binDir = path.dirname(serverPath);
            execSync(`xattr -cr "${binDir}"`, { stdio: 'ignore' });
            execSync(`chmod +x "${serverPath}"`, { stdio: 'ignore' });
            console.log('[LLMService] Cleared quarantine attributes from bin directory');
        } catch (e) {
            console.warn('[LLMService] Could not clear quarantine attributes:', e);
        }
    }

    const binDir = path.dirname(serverPath);

    const args = ["-m", this.modelPath];
    if (this.mmProjPath) args.push("--mmproj", this.mmProjPath);
    args.push(
      "--port", String(this.port),
      "--host", "127.0.0.1",
      "-c", String(this.safeCtxSize(this.ctxSize)),
      "-ngl", String(this.gpuLayers)
    );
    // FlashAttention: faster + lower memory. Required for a quantized KV cache.
    if (this.flashAttn || this.kvCacheType !== "f16") args.push("--flash-attn", "on");
    // Quantized KV cache (q8_0/q4_0) shrinks the per-token memory footprint — the
    // single biggest lever against memory-overcommit freezes on big contexts.
    if (this.kvCacheType !== "f16") {
      args.push("--cache-type-k", this.kvCacheType, "--cache-type-v", this.kvCacheType);
    }
    if (typeof this.threads === "number") args.push("-t", String(this.threads));
    if (typeof this.batchSize === "number") args.push("-b", String(this.batchSize));
    // Kill any lingering server before spawning (defends against a crashed or
    // orphaned instance still holding the port / RAM).
    if (this.server) {
      try { this.server.kill("SIGKILL"); } catch { /* ignore */ }
      this.server = null;
    }
    // ALSO kill an ORPHANED server from a previous app process — when the app
    // restarts, the old llama-server keeps holding the port, so a new spawn can't
    // bind and config changes (ctx size, model) silently never take effect. Find
    // whatever owns the port and kill it.
    try {
      const pids = execSync(`lsof -ti tcp:${this.port}`, { encoding: "utf-8" }).trim().split("\n").filter(Boolean);
      let killed = 0;
      for (const pid of pids) {
        // ONLY kill a process we recognize as our own llama-server. The port is
        // ours by convention, not by reservation — blindly SIGKILLing whatever
        // holds it would take down an unrelated app that happened to bind it.
        let cmd = "";
        try { cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" }).trim(); } catch { continue; /* already gone */ }
        if (!/llama-server/i.test(cmd)) {
          console.warn(`[LLMService] port ${this.port} held by non-llama process ${pid} (${cmd.slice(0, 80)}) — leaving it alone`);
          continue;
        }
        try { process.kill(Number(pid), "SIGKILL"); killed++; console.log(`[LLMService] killed orphaned llama-server ${pid} on port ${this.port}`); } catch { /* gone */ }
      }
      if (killed) await new Promise((r) => setTimeout(r, 400)); // let the port free
    } catch { /* nothing on the port */ }

    const proc = spawn(serverPath, args, {
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: binDir,
      },
    });
    this.server = proc;
    this.stderrTail = [];

    proc.stderr?.on("data", (data) => {
      const text = String(data);
      console.log(`[llama-server] ${text}`);
      // Keep a rolling tail so we can classify a load failure after it exits.
      for (const line of text.split(/\r?\n/)) if (line.trim()) this.stderrTail.push(line);
      if (this.stderrTail.length > 50) this.stderrTail = this.stderrTail.slice(-50);
    });

    proc.on("close", (code, signal) => {
        console.log(`[llama-server] exited with code ${code} signal ${signal}`);
        // Ignore the close of a PROCESS WE'VE ALREADY REPLACED: on restart/reload,
        // stop() kills the old proc and init() spawns a new one; the old proc's
        // close event fires async and must not null out the live server.
        if (this.server !== proc) return;
        const wasIntentional = this.intentionalStop;
        this.intentionalStop = false;
        this.server = null;
        this.initialized = false;
        // If it died on its own (not our stop/swap), translate the stderr into a
        // human reason so the Health panel can say WHY instead of a blank "Down".
        const deliberateClose = wasIntentional || signal === 'SIGKILL' || signal === 'SIGTERM';
        if (!deliberateClose && !this.paused) {
          const failure = classifyLlamaError(this.stderrTail.join('\n'));
          if (failure) {
            this.lastErrorMsg = failure.reason;
            console.error(`[LLMService] llama-server load failure (${failure.code}): ${failure.reason}`);
          }
        }
        // Do NOT auto-restart a DELIBERATE kill — a user/OS `kill` (SIGKILL/SIGTERM)
        // or our own teardown. Otherwise killing llama-server just respawns it,
        // making it impossible to stop without killing the whole app. Only recover
        // from a genuine crash (non-zero code / SIGABRT) we didn't initiate.
        const deliberate = signal === 'SIGKILL' || signal === 'SIGTERM';
        if (!wasIntentional && !this.paused && !deliberate) this.handleCrash(code ?? -1);
    });

    try {
        await this.waitForReady();
        console.log("[LLMService] Vision server ready!");
        this.initialized = true;
        this.lastErrorMsg = null; // healthy again — clear any prior failure reason
    } catch (e) {
        console.error("[LLMService] Failed to start server:", e);
        this.stop();
    }
  }

  /** Auto-recover from an unexpected llama-server crash. Backs off, and on repeated
   *  crashes shrinks the context (the usual culprit is memory pressure) before
   *  retrying. Gives up after a few attempts so we never spin forever. */
  private async handleCrash(code: number): Promise<void> {
    // Rolling 2-minute window: if it has already died 3× recently, STOP recovering.
    // Prevents thrash-respawning a multi-GB process when the model is too heavy for
    // the machine (memory-pressure kills). Surface it; the user can pick a smaller
    // model / Conservative mode or hit Health → Restart.
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < 120_000);
    if (this.restartTimes.length >= 3) {
      console.error(`[LLMService] llama-server died ${this.restartTimes.length + 1}× in 2min (last code ${code}); NOT auto-restarting — likely memory pressure. Pick a smaller model or Conservative mode.`);
      return;
    }
    this.restartTimes.push(now);
    // On a repeat death in the window, halve the context — usually OOM/overcommit.
    if (this.restartTimes.length >= 2) {
      const reduced = Math.max(2048, Math.floor((this.ctxSize / 2) / 1024) * 1024);
      if (reduced < this.ctxSize) {
        console.warn(`[LLMService] reducing context ${this.ctxSize} -> ${reduced} after repeated crashes`);
        this.ctxSize = reduced;
        try { fs.writeFileSync(this.settingsFile, JSON.stringify(this.getSettings())); } catch { /* ignore */ }
      }
    }
    await new Promise((r) => setTimeout(r, 1000 * this.restartTimes.length));
    if (this.paused || this.intentionalStop) return;
    console.log(`[LLMService] auto-restarting llama-server (attempt ${this.restartTimes.length})`);
    this.init().catch(() => {});
  }

  private async waitForReady(timeout = 60000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Server failed to start");
  }

  // Use Node http module instead of fetch to avoid undici's headersTimeout (300s)
  // which kills long-running LLM requests before they can respond
  private httpPost(body: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        req.destroy();
        reject(new Error("LLM request timed out - try a shorter prompt"));
      }, timeoutMs);

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timer);
          if (timedOut) return;
          if (res.statusCode !== 200) {
            reject(new Error(`LLM Server Error: ${res.statusCode} ${data}`));
            return;
          }
          resolve(data);
        });
      });

      req.on('error', (e) => {
        clearTimeout(timer);
        if (timedOut) return;
        reject(e);
      });

      req.write(body);
      req.end();
    });
  }

  async chat(
    message: string,
    images: string[] = [],
    timeoutMs: number = 300000,
    maxTokens: number = 2048,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts: { responseFormat?: any; temperature?: number; disableThinking?: boolean } = {}
  ): Promise<string> {
    if (this.paused) throw new Error("LLM paused during image generation — deferred");
    if (!this.initialized) {
        await this.init();
        if (!this.initialized) {
             throw new Error("LLM Service not ready");
        }
    }

    return this.chatMutex.runExclusive(async () => {
    try {
        const messages: any[] = [{
            role: "user",
            content: []
        }];

        messages[0].content.push({ type: "text", text: message });

        for (const imgPath of images) {
            try {
                const imageBuffer = fs.readFileSync(imgPath);
                const base64 = imageBuffer.toString("base64");
                const mime = imgPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

                messages[0].content.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${mime};base64,${base64}`
                    }
                });
            } catch (readErr) {
                console.error(`[LLMService] Failed to read image ${imgPath}:`, readErr);
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (this.systemPrompt.trim()) messages.unshift({ role: "system", content: this.systemPrompt });
        const payload: any = {
            messages: messages,
            max_tokens: maxTokens,
            temperature: opts.temperature ?? this.temperature,
            ...this.samplingPayload(),
        };
        // Grammar-constrained output: llama.cpp converts the JSON schema to a
        // GBNF grammar so the model can ONLY emit valid matching JSON.
        if (opts.responseFormat) payload.response_format = opts.responseFormat;
        // Turn off the model's reasoning channel for fast, direct output (its
        // chain-of-thought otherwise eats the token budget and leaves content empty).
        if (opts.disableThinking) payload.chat_template_kwargs = { enable_thinking: false };
        const body = JSON.stringify(payload);

        console.log(`[LLMService] Starting LLM request (timeout: ${timeoutMs/1000}s, body: ${body.length} chars)...`);

        const raw = await this.httpPost(body, timeoutMs);
        const data = JSON.parse(raw);
        console.log('[LLMService] LLM request completed');
        // Best-effort fleet audit: record the local model call if enrolled in a
        // console. The fleet console is a pro feature — it registers this hook in
        // its activation; the free build has no hook and this is a no-op.
        try {
            const tokens = data.usage?.total_tokens ?? 0;
            const modelName = path.basename(this.modelPath) || 'local-llm';
            callHook('console.recordModelCall', modelName, tokens, 'ok', false);
        } catch { /* audit is never load-bearing */ }
        return data.choices?.[0]?.message?.content ?? "";

    } catch (e: any) {
        console.error("[LLMService] Chat error:", e.message || e);
        throw e;
    }
    });
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
    maxTokens: number = 2048,
    timeoutMs: number = 300000,
  ): Promise<string> {
    if (this.paused) throw new Error('LLM paused during image generation — deferred');
    if (!this.initialized) {
      await this.init();
      if (!this.initialized) throw new Error('LLM Service not ready');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [{ type: 'text', text: message }];
    for (const imgPath of images) {
      try {
        const base64 = fs.readFileSync(imgPath).toString('base64');
        const mime = imgPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
      } catch (e) {
        console.error(`[LLMService] Failed to read image ${imgPath}:`, e);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content }];
    if (this.systemPrompt.trim()) messages.unshift({ role: 'system', content: this.systemPrompt });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      messages,
      max_tokens: this.maxTokens || maxTokens,
      temperature: opts.temperature ?? this.temperature,
      ...this.samplingPayload(),
      stream: true,
    };
    // Thinking control: when on, ask the template to emit reasoning and have
    // llama.cpp split it into reasoning_content (deepseek-style); when off,
    // suppress it so the token budget goes to the answer.
    if (opts.thinking) {
      payload.chat_template_kwargs = { enable_thinking: true };
      payload.reasoning_format = 'deepseek';
    } else {
      payload.chat_template_kwargs = { enable_thinking: false };
    }
    const body = JSON.stringify(payload);

    return new Promise<string>((resolve, reject) => {
      let full = '';
      let buf = '';
      let inThink = false; // for models that inline <think>…</think> in content
      let timedOut = false;
      let aborted = false;
      const timer = setTimeout(() => { timedOut = true; req.destroy(); reject(new Error('LLM request timed out')); }, timeoutMs);

      const emitContent = (text: string): void => {
        // Split out inline <think> reasoning if the template uses it.
        let rest = text;
        while (rest) {
          if (inThink) {
            const end = rest.indexOf('</think>');
            if (end === -1) { onDelta(rest, 'reasoning'); return; }
            if (end > 0) onDelta(rest.slice(0, end), 'reasoning');
            rest = rest.slice(end + 8);
            inThink = false;
          } else {
            const start = rest.indexOf('<think>');
            if (start === -1) { full += rest; onDelta(rest, 'content'); return; }
            if (start > 0) { full += rest.slice(0, start); onDelta(rest.slice(0, start), 'content'); }
            rest = rest.slice(start + 7);
            inThink = true;
          }
        }
      };

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        if (res.statusCode !== 200) { clearTimeout(timer); reject(new Error(`LLM Server Error: ${res.statusCode}`)); res.resume(); return; }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta;
              if (delta?.reasoning_content) onDelta(delta.reasoning_content, 'reasoning');
              if (delta?.content) emitContent(delta.content);
            } catch { /* partial/ignorable line */ }
          }
        });
        res.on('end', () => { clearTimeout(timer); if (!timedOut && !aborted) resolve(full); });
      });
      req.on('error', (e) => { clearTimeout(timer); if (!timedOut && !aborted) reject(e); });
      // Cooperative cancellation: stop the request and return whatever was generated so far.
      if (opts.signal) {
        const onAbort = (): void => { aborted = true; clearTimeout(timer); try { req.destroy(); } catch { /* already gone */ } resolve(full); };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      req.write(body);
      req.end();
    });
  }

  stop() {
    if (this.server) {
        this.intentionalStop = true; // deliberate shutdown — don't auto-restart
        this.server.kill();
        this.server = null;
        this.initialized = false;
    }
  }

  /** Pause for image generation: free the server and block respawns until resumed. */
  pause() {
    this.paused = true;
    this.stop();
  }

  /** Resume after image generation and warm the server back up. */
  resume() {
    this.paused = false;
    this.init().catch(() => {});
  }

  isReady() {
      return this.initialized;
  }

  /** True when the server process is alive but the model hasn't finished loading
   *  yet — the normal several-second warm-up (gemma-4 at -ngl 99 isn't instant).
   *  Lets Health show "Loading model…" instead of a scary "server is not running"
   *  during a cold start. */
  isStarting() {
      return this.server !== null && !this.initialized;
  }

  /** Human, actionable reason the chat server failed to start (null when healthy
   *  or never failed). Surfaced in the Health panel so "Down" explains itself. */
  lastError(): string | null {
      return this.lastErrorMsg;
  }

  /** Hard restart: kill the server and spawn it fresh (picks up a model swap or
   *  recovers a crashed/hung instance). Used by "Configure for me" and the
   *  Health panel's restart action. */
  async restart(): Promise<void> {
      this.stop();
      this.initialized = false;
      this.resolveModel();
      await this.init();
  }
}

export const llm = new LLMService();

onHostQuit(() => {
    llm.stop();
});
