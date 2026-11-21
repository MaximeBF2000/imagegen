import { ASPECT_RATIOS, type ImageModel } from './types.js';

/**
 * Image models served by the local inference server (apps/inference/server.py).
 * The ids must match the `MODELS` registry there; to add a model, add an entry in
 * both places (loading code in Python, capabilities here).
 */
export const LOCAL_MODELS: ImageModel[] = [
  {
    id: 'flux2-klein-4b',
    label: 'FLUX.2 [klein] 4B',
    description: 'Fast distilled model (4 steps). Text-to-image, multi-reference editing and native inpainting.',
    aliases: ['black-forest-labs/FLUX.2-klein-4B'],
    capabilities: { maxReferenceImages: 4, nativeInpainting: true, aspectRatios: [...ASPECT_RATIOS, 'auto'], seed: true },
  },
  {
    id: 'qwen-image-2.1-turbo',
    label: 'Qwen-Image 2.1 Turbo',
    description: 'Qwen-Image 2.1 Turbo (8 steps) with the uncensored Qwen3-VL text encoder, both Q8 GGUF. Strong at text rendering.',
    capabilities: { maxReferenceImages: 4, nativeInpainting: false, aspectRatios: [...ASPECT_RATIOS, 'auto'], seed: true },
  },
  {
    id: 'qwen-image-2.1',
    label: 'Qwen-Image 2.1',
    description:
      'The original (non-Turbo) Qwen-Image 2.1, Q8 GGUF, 30 steps: ~4× slower than Turbo, but it’s what most LoRAs are trained on (some only work here).',
    capabilities: { maxReferenceImages: 4, nativeInpainting: false, aspectRatios: [...ASPECT_RATIOS, 'auto'], seed: true },
  },
  {
    id: 'flux3-klein',
    label: 'FLUX 3 [klein]',
    description: 'FLUX 3 Image klein (16 steps) with the uncensored Qwen3-VL-4B text encoder, both Q8 GGUF. Likes detailed captions.',
    capabilities: { maxReferenceImages: 4, nativeInpainting: false, aspectRatios: [...ASPECT_RATIOS, 'auto'], seed: true },
  },
];
