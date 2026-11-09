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
];
