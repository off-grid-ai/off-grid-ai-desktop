import type { Credibility } from './credibility';
export type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen';
export type CredibilityFilter = 'all' | Credibility;
export type SizeFilter = 'all' | 'tiny' | 'small' | 'medium' | 'large';
export type SortOption = 'recommended' | 'bestfit' | 'size' | 'downloads' | 'recency';
export interface FilterState {
    orgs: string[];
    type: ModelTypeFilter;
    source: CredibilityFilter;
    size: SizeFilter;
    quant: string;
    sort: SortOption;
}
export declare const initialFilterState: FilterState;
/** Normalized model the filters/sorts operate on (map HF results into this). */
export interface FilterableModel {
    id: string;
    name: string;
    org: string;
    credibility?: Credibility;
    params?: number | null;
    tags?: string[];
    downloads?: number;
    likes?: number;
    lastModified?: string;
    minRamGb?: number;
    files?: {
        sizeBytes?: number;
        quant?: string;
    }[];
}
export declare const SIZE_OPTIONS: readonly [{
    readonly key: "tiny";
    readonly label: "Tiny (<2B)";
    readonly min: 0;
    readonly max: 2;
}, {
    readonly key: "small";
    readonly label: "Small (2-5B)";
    readonly min: 2;
    readonly max: 5;
}, {
    readonly key: "medium";
    readonly label: "Medium (5-15B)";
    readonly min: 5;
    readonly max: 15;
}, {
    readonly key: "large";
    readonly label: "Large (15B+)";
    readonly min: 15;
    readonly max: number;
}];
export declare const MODEL_TYPE_OPTIONS: readonly [{
    readonly key: "text";
    readonly label: "Text";
}, {
    readonly key: "vision";
    readonly label: "Vision";
}, {
    readonly key: "code";
    readonly label: "Code";
}, {
    readonly key: "image-gen";
    readonly label: "Image";
}];
export declare const CREDIBILITY_OPTIONS: readonly [{
    readonly key: "offgrid";
    readonly label: "Off Grid";
}, {
    readonly key: "official";
    readonly label: "Official";
}, {
    readonly key: "verified-quantizer";
    readonly label: "Verified";
}, {
    readonly key: "community";
    readonly label: "Community";
}];
export declare const SORT_OPTIONS: readonly [{
    readonly key: "recommended";
    readonly label: "Recommended";
}, {
    readonly key: "bestfit";
    readonly label: "Best fit";
}, {
    readonly key: "downloads";
    readonly label: "Downloads";
}, {
    readonly key: "size";
    readonly label: "Size";
}, {
    readonly key: "recency";
    readonly label: "Recent";
}];
/** Parse a billions-of-parameters count from a model name/id, in billions
 *  ("Qwen3.5-2B" -> 2, "SmolVLM2-500M" -> 0.5). Returns null if none found. */
export declare function parseParamCount(nameOrId: string): number | null;
/** Detect a model's type from its name + tags. */
export declare function getModelType(name: string, tags?: string[]): ModelTypeFilter;
/** Lower is better. Ideal model uses ~40% of RAM; penalize >75% (too slow). */
export declare function bestFitScore(m: FilterableModel, ramGb: number): number;
export declare function hasActiveFilters(state: FilterState): boolean;
export declare function applyFilters<T extends FilterableModel>(models: T[], state: FilterState): T[];
export declare function applySort<T extends FilterableModel>(models: T[], sort: SortOption, ramGb?: number): T[];
/** Apply filters then sort in one pass. */
export declare function filterAndSort<T extends FilterableModel>(models: T[], state: FilterState, ramGb?: number): T[];
