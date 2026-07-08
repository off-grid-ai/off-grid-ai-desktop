import { D as DownloadBridge } from '../types-Dbo7SGxu.js';

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
