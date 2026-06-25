import { D as DownloadBridge } from '../types-C3JiELTS.mjs';

declare class NodeDownloadBridge implements DownloadBridge {
    private readonly modelsDir;
    constructor(modelsDir: string);
    pathFor(fileName: string): string;
    exists(destPath: string, expectedBytes?: number): Promise<boolean>;
    download(url: string, destPath: string, opts: {
        onProgress?: (written: number, total: number) => void;
        signal?: AbortSignal;
    }): Promise<number>;
}

export { NodeDownloadBridge };
