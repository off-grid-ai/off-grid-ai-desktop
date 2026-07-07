export interface QuantInfo {
    bitsPerWeight: number;
    quality: string;
    description: string;
    recommended: boolean;
}
export declare const QUANTIZATION_INFO: Record<string, QuantInfo>;
/** Extract a quantization label from a GGUF filename. */
export declare function extractQuantization(fileName: string): string;
export declare function isMMProjFile(fileName: string): boolean;
export declare function formatFileSize(bytes: number): string;
