// Image generation contract: text-to-image AND image-to-image. The actual
// diffusion runtime (stable-diffusion.cpp / CoreML on desktop, MNN/QNN on
// mobile) is a platform adapter implementing ImageGenProvider; this package
// defines the shared request/result shape + capability so UI and orchestration
// are identical across platforms.

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

export function supportsMode(provider: ImageGenProvider, mode: ImageGenMode): boolean {
  return provider.modes.includes(mode);
}

/** Validate a request against a provider's capabilities before running it. */
export function validateImageGenRequest(provider: ImageGenProvider, req: ImageGenRequest): string | null {
  if (!supportsMode(provider, req.mode)) return `provider does not support ${req.mode}`;
  if (req.mode === 'img2img' && !req.initImage) return 'img2img requires an initImage';
  if (!req.prompt.trim()) return 'prompt is required';
  return null;
}
