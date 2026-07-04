import type { ModelEntry, ModelKind, ModelRecommendationTier } from './types';
export declare const RECOMMENDATION_TIERS: ModelRecommendationTier[];
export declare function recommendForRam(ramGb: number): ModelRecommendationTier;
export declare const CATALOG: ModelEntry[];
export declare function modelsByKind(kind: ModelKind): ModelEntry[];
export declare const MODEL_KINDS: ModelKind[];
