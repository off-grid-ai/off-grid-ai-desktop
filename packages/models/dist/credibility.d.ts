export type Credibility = 'offgrid' | 'official' | 'verified-quantizer' | 'community';
export declare const OFFGRID_AUTHORS: string[];
export declare const OFFICIAL_MODEL_AUTHORS: Record<string, string>;
export declare const VERIFIED_QUANTIZERS: Record<string, string>;
export declare const CREDIBILITY_LABELS: Record<Credibility, {
    label: string;
    description: string;
    color: string;
}>;
/** Classify a HF author into a credibility tier. */
export declare function determineCredibility(author: string): Credibility;
