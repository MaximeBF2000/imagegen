import type { Upscaler } from './types.js';

/**
 * Upscalers served by the local inference server (apps/inference/upscalers.py).
 * The ids must match the `UPSCALERS` registry there; to add one, add an entry in
 * both places (runtime code in Python, catalog here).
 */
export const LOCAL_UPSCALERS: Upscaler[] = [
  {
    id: 'seedvr2-7b-8bit',
    label: 'SeedVR2 7B',
    description: 'Diffusion super-resolution (ByteDance SeedVR2 7B, 8-bit MLX). Restores detail; Apple Silicon only.',
    scales: [2, 4],
    maxSide: 8192,
  },
];
