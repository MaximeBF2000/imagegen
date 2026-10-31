/**
 * Provider contracts.
 *
 * Everything model-specific lives behind these two interfaces. To run the app
 * against a local model (diffusers, ComfyUI, a custom Python server...), write a
 * class implementing `ImageProvider` and register it in `registry.ts`.
 * Nothing else in the codebase needs to change.
 */

export const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface InputImage {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  /** 'auto' lets the model choose (usually: match the first reference image). */
  aspectRatio: AspectRatio | 'auto';
  /** Pixel size matching the aspect ratio (~1 megapixel), for engines that need explicit dimensions. */
  width: number;
  height: number;
  seed: number;
  /** Reference / input images for image-to-image and multi-reference editing. */
  referenceImages: InputImage[];
  /**
   * Native inpainting: only set when the provider declares `nativeInpainting`.
   * `mask` is a single-channel PNG the size of `image`; white = repaint, black = keep.
   */
  inpaint?: { image: InputImage; mask: Buffer };
  signal: AbortSignal;
}

export interface ImageGenerationResult {
  data: Buffer;
  mime: string;
  /** Optional provider metadata (cost, timings...) stored with the job. */
  meta?: Record<string, unknown>;
}

export interface ImageProviderCapabilities {
  maxReferenceImages: number;
  /** If false, the app emulates inpainting with a marked reference + mask compositing. */
  nativeInpainting: boolean;
  aspectRatios: ReadonlyArray<AspectRatio | 'auto'>;
  seed: boolean;
}

export interface ImageProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ImageProviderCapabilities;
  /** Returns a human readable reason if the provider can't run (e.g. missing API key). */
  readiness(): string | null;
  generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface TextCompletionRequest {
  system: string;
  user: string;
  images?: InputImage[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface TextProvider {
  readonly id: string;
  readonly model: string;
  readiness(): string | null;
  complete(req: TextCompletionRequest): Promise<string>;
}

/** Error carrying a flag telling the queue whether retrying makes sense. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
export const TEXT_PROVIDER = Symbol('TEXT_PROVIDER');

/** ~1MP dimensions for an aspect ratio, rounded to multiples of 16. */
export function dimensionsFor(ratio: AspectRatio | 'auto', fallback?: { width: number; height: number }) {
  if (ratio === 'auto') {
    if (!fallback) return { width: 1024, height: 1024 };
    const r = fallback.width / fallback.height;
    return roundDims(r);
  }
  const [w, h] = ratio.split(':').map(Number);
  return roundDims(w / h);
}

function roundDims(r: number) {
  const area = 1024 * 1024;
  const height = Math.sqrt(area / r);
  const width = height * r;
  const snap = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return { width: snap(width), height: snap(height) };
}
