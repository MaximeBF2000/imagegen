import type { AppConfig } from '../config.js';
import { MockImageProvider, MockTextProvider, MockUpscaleProvider } from './mock.providers.js';
import { OpenAICompatibleTextProvider } from './openai-compatible-text.provider.js';
import { LocalImageProvider, LocalTextProvider, LocalUpscaleProvider } from './local-diffusers.provider.js';
import type { ImageProvider, TextProvider, UpscaleProvider } from './types.js';

/**
 * Provider registry: maps the IMAGE_PROVIDER / TEXT_PROVIDER env values to
 * implementations. Add another engine (ComfyUI, MLX, a remote API...) here, e.g.
 *
 *   comfy: (cfg) => new ComfyImageProvider(process.env.COMFY_URL)
 */
const imageProviders: Record<string, (cfg: AppConfig) => ImageProvider> = {
  local: (cfg) => new LocalImageProvider(cfg.image.model, cfg.inference.url),
  mock: () => new MockImageProvider(),
};

/** Upscalers follow IMAGE_PROVIDER (local inference server, or mock). */
const upscaleProviders: Record<string, (cfg: AppConfig) => UpscaleProvider> = {
  local: (cfg) => new LocalUpscaleProvider(cfg.upscale.upscaler, cfg.inference.url),
  mock: () => new MockUpscaleProvider(),
};

const textProviders: Record<string, (cfg: AppConfig) => TextProvider> = {
  'openai-compatible': (cfg) => new OpenAICompatibleTextProvider(cfg.text),
  local: (cfg) => new LocalTextProvider(cfg.inference.url),
  mock: () => new MockTextProvider(),
};

export function createImageProvider(cfg: AppConfig): ImageProvider {
  const factory = imageProviders[cfg.image.provider];
  if (!factory) {
    throw new Error(`Unknown IMAGE_PROVIDER "${cfg.image.provider}". Available: ${Object.keys(imageProviders).join(', ')}`);
  }
  return factory(cfg);
}

export function createTextProvider(cfg: AppConfig): TextProvider {
  const factory = textProviders[cfg.text.provider];
  if (!factory) {
    throw new Error(`Unknown TEXT_PROVIDER "${cfg.text.provider}". Available: ${Object.keys(textProviders).join(', ')}`);
  }
  return factory(cfg);
}

export function createUpscaleProvider(cfg: AppConfig): UpscaleProvider {
  const factory = upscaleProviders[cfg.image.provider];
  if (!factory) {
    throw new Error(`No upscaler for IMAGE_PROVIDER "${cfg.image.provider}". Available: ${Object.keys(upscaleProviders).join(', ')}`);
  }
  return factory(cfg);
}
