type ModelKind = 'text' | 'vision' | 'image' | 'voice' | 'transcription';
interface ModelFile {
    /** Filename on disk, e.g. "Qwen3.5-2B-Q4_K_M.gguf". */
    name: string;
    /** Download URL (often a Hugging Face resolve URL). */
    url: string;
    /** Size in bytes when known (for progress + RAM/disk checks). */
    sizeBytes?: number;
    /** Marks an auxiliary file (e.g. a vision mmproj) vs the primary weights. */
    role?: 'primary' | 'mmproj' | 'tokenizer' | 'aux';
}
interface ModelEntry {
    /** Stable id, usually the HF repo id, e.g. "unsloth/Qwen3.5-2B-GGUF". */
    id: string;
    name: string;
    kind: ModelKind;
    /** Provider/org, e.g. "google", "Qwen", "openai-whisper". */
    org?: string;
    description?: string;
    /** Billions of parameters (LLMs); omitted for non-LLM kinds. */
    params?: number;
    /** Minimum device RAM (GB) recommended. */
    minRamGb?: number;
    /** Quantization label, e.g. "Q4_K_M". */
    quant?: string;
    /** Files to download for this model. */
    files: ModelFile[];
    isNew?: boolean;
}
/** RAM tier -> max model size + quant, for recommending a default model. */
interface ModelRecommendationTier {
    minRamGb: number;
    maxRamGb: number;
    maxParams: number;
    quantization: string;
}
type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
interface DownloadProgress {
    modelId: string;
    status: DownloadStatus;
    /** 0..1 across all of the model's files. */
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
    currentFile?: string;
    speedBytesPerSec?: number;
    error?: string;
}
/** Platform file download (Node/Electron streams to disk; RN background downloader). */
interface DownloadBridge {
    /** Download `url` to `destPath`. Resume if a partial file exists. Returns the
     * bytes written. Call onProgress(bytesWritten, totalBytes) as it streams. */
    download(url: string, destPath: string, opts: {
        onProgress?: (written: number, total: number) => void;
        signal?: AbortSignal;
    }): Promise<number>;
    /** Whether a fully-downloaded file already exists (size match). */
    exists(destPath: string, expectedBytes?: number): Promise<boolean>;
    /** Join the models directory with a filename. */
    pathFor(fileName: string): string;
}
/** Records which models are installed (a memory entity or local store). */
interface ModelStore {
    markInstalled(entry: ModelEntry): void;
    isInstalled(modelId: string): boolean;
    installed(): ModelEntry[];
    remove(modelId: string): void;
}

export type { DownloadBridge as D, ModelEntry as M, ModelKind as a, ModelRecommendationTier as b, ModelStore as c, DownloadProgress as d, DownloadStatus as e, ModelFile as f };
