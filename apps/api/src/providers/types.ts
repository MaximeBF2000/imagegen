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
  /** Catalog id of the model to run (one of the provider's `models`). */
  model: string;
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
  /** LoRAs to apply (only ids from the provider's `loras` that support `model`). */
  loras?: LoraRef[];
  signal: AbortSignal;
}

/** A LoRA enabled for a generation, with its strength (1 = as trained). */
export interface LoraRef {
  id: string;
  scale: number;
}

/** One LoRA adapter the user can enable on top of the models it supports. */
export interface Lora {
  /** Stable id, sent by clients in `loras[].id` and stored with generations. */
  id: string;
  label: string;
  description?: string;
  /** Model ids this LoRA works with (the model → LoRA mapping). */
  models: string[];
  /** Trigger word, prepended to the prompt when the LoRA is on (unless already there). */
  trigger?: string;
  /** Strength used when a request doesn't give one. */
  defaultScale: number;
  /** Where it comes from (model page). */
  source?: string;
  /** Short how-to shown in the picker (recommended strength, prompt style…). */
  usage?: string;
  /** Prompt to start from (e.g. an edit LoRA's exact instruction); the picker can insert it. */
  promptTemplate?: string;
  /** Edit LoRA: works on a reference image, so generations need at least one. */
  needsImage?: boolean;
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

/** One selectable image model. Each generation records the model it ran with. */
export interface ImageModel {
  /** Stable id, sent by clients as `model` and stored with generations. */
  id: string;
  label: string;
  description?: string;
  /** Older ids that resolve to this model (e.g. Hugging Face repo ids stored by earlier versions). */
  aliases?: string[];
  capabilities: ImageProviderCapabilities;
}

export interface ImageProvider {
  readonly id: string;
  /** Models this provider can run; the user picks one per generation. */
  readonly models: readonly ImageModel[];
  /** Id of the model used when a request doesn't name one. */
  readonly defaultModel: string;
  /** LoRAs this provider can apply (empty / omitted when it has none). */
  readonly loras?: readonly Lora[];
  /** Returns a human readable reason if the provider can't run (e.g. missing API key). */
  readiness(): string | null;
  /** Null when the LoRA can be used, otherwise why not (e.g. not downloaded). */
  loraIssue?(id: string): string | null;
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

/** Exact lookup by id or alias; undefined when the provider has no such model. */
export function findModel(provider: ImageProvider, id: string): ImageModel | undefined {
  return provider.models.find((m) => m.id === id || m.aliases?.includes(id));
}

/** Like findModel, but falls back to the default model (e.g. for generations made with a since-removed model). */
export function modelOrDefault(provider: ImageProvider, id?: string | null): ImageModel {
  return (id && findModel(provider, id)) || findModel(provider, provider.defaultModel) || provider.models[0];
}

/** LoRAs of `provider` usable with `modelId`. */
export function lorasFor(provider: ImageProvider, modelId: string): Lora[] {
  return (provider.loras ?? []).filter((l) => l.models.includes(modelId));
}

/** Prepends the trigger words of `loras` the prompt doesn't already contain. */
export function withTriggers(prompt: string, loras: readonly Lora[]): string {
  const missing = loras.map((l) => l.trigger).filter((t): t is string => !!t && !prompt.toLowerCase().includes(t.toLowerCase()));
  // "cndamiph" -> "cndamiph, prompt"; a trigger that ends a sentence ("fusal style.") -> "fusal style. prompt".
  // A structured prompt ("[TASK: …]") goes on its own line after the trigger.
  return missing.reduceRight((text, t) => `${t}${/[.!?:;,]$/.test(t) ? (text.startsWith('[') ? '\n' : ' ') : ', '}${text}`, prompt);
}

/** One selectable upscaling model. Each upscale records the upscaler it ran with. */
export interface Upscaler {
  /** Stable id, sent by clients as `upscaler` and stored with upscales. */
  id: string;
  label: string;
  description?: string;
  /** Accepted scale factors (e.g. [2, 4]). */
  scales: number[];
  /** Largest output side in pixels. */
  maxSide: number;
}

export interface UpscaleRequest {
  upscaler: string;
  image: InputImage;
  scale: number;
  seed: number;
  signal: AbortSignal;
}

/**
 * Upscaling engine. Like ImageProvider, implement it for another backend and
 * register it in `registry.ts`; adding a model to an existing backend only needs
 * a catalog entry (see upscalers.ts) plus its runtime code.
 */
export interface UpscaleProvider {
  readonly id: string;
  readonly upscalers: readonly Upscaler[];
  readonly defaultUpscaler: string;
  /** Null when `upscaler` can run, otherwise why not (not installed, server down…). */
  readiness(upscaler?: string): string | null;
  upscale(req: UpscaleRequest): Promise<ImageGenerationResult>;
}

export function findUpscaler(provider: UpscaleProvider, id?: string | null): Upscaler | undefined {
  return provider.upscalers.find((u) => u.id === (id || provider.defaultUpscaler));
}

export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
export const UPSCALE_PROVIDER = Symbol('UPSCALE_PROVIDER');
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
