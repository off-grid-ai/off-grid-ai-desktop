export type ImageGenMode = 'txt2img' | 'img2img';
export interface ImageGenRequest {
    prompt: string;
    mode: ImageGenMode;
    negativePrompt?: string;
    /** Input image for img2img (base64 data URL or local path). */
    initImage?: string;
    /** img2img denoising strength, 0..1 (how much to change the input). */
    strength?: number;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    signal?: AbortSignal;
}
export interface ImageGenResult {
    /** Output image (base64 data URL or local path). */
    image: string;
    seed?: number;
}
/** A platform diffusion runtime. Implemented per-platform, used the same way. */
export interface ImageGenProvider {
    readonly id: string;
    /** Modes this provider/model supports (e.g. ['txt2img','img2img']). */
    readonly modes: ImageGenMode[];
    generate(req: ImageGenRequest): Promise<ImageGenResult>;
}
export declare function supportsMode(provider: ImageGenProvider, mode: ImageGenMode): boolean;
/** Validate a request against a provider's capabilities before running it. */
export declare function validateImageGenRequest(provider: ImageGenProvider, req: ImageGenRequest): string | null;
