import type { ModelEntry, ModelKind } from './types';
import { type Credibility } from './credibility';
type FetchLike = (url: string, init?: {
    headers?: Record<string, string>;
}) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;
export interface HFSearchResult {
    id: string;
    name: string;
    org: string;
    downloads?: number;
    likes?: number;
    lastModified?: string;
    credibility: Credibility;
}
/** A selectable quantization variant within a HF repo (for the file picker). */
export interface ModelFileVariant {
    fileName: string;
    quant: string;
    quality: string;
    recommended: boolean;
    sizeBytes: number;
    downloadUrl: string;
    /** Matched vision projector for this weight, when the repo is multimodal. */
    mmproj?: {
        fileName: string;
        url: string;
        sizeBytes?: number;
    };
}
/** Search the HF hub for models, scoped to a modality (kind) when given so each
 *  tab only surfaces models it can actually use. */
export declare function searchHuggingFace(query: string, opts?: {
    limit?: number;
    sort?: string;
    kind?: ModelKind;
    fetchImpl?: FetchLike;
}): Promise<HFSearchResult[]>;
/** List a repo's GGUF quantization variants (with matched mmproj), for a file
 * picker. Sorted recommended-first, then smallest. */
export declare function getModelFiles(repoId: string, opts?: {
    fetchImpl?: FetchLike;
}): Promise<ModelFileVariant[]>;
/**
 * Resolve a HF repo into a downloadable ModelEntry: a primary GGUF (preferring
 * Q4_K_M) plus a matching mmproj when the repo is multimodal. Returns null if no
 * usable GGUF is found.
 */
export declare function resolveHuggingFaceModel(repoId: string, opts?: {
    kind?: ModelKind;
    fetchImpl?: FetchLike;
}): Promise<ModelEntry | null>;
export {};
