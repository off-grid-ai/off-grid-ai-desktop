import type { DownloadBridge, DownloadProgress, ModelEntry, ModelStore } from './types';
export declare class ModelDownloader {
    private readonly bridge;
    private readonly store;
    private aborts;
    private listeners;
    constructor(bridge: DownloadBridge, store: ModelStore);
    onProgress(cb: (p: DownloadProgress) => void): () => void;
    isInstalled(modelId: string): boolean;
    cancel(modelId: string): void;
    private emit;
    download(entry: ModelEntry): Promise<boolean>;
}
