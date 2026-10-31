import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config.js';
import {
  ASPECT_RATIOS,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageProvider,
  ProviderError,
} from './types.js';

/**
 * Image generation through OpenRouter's Images API (POST /images).
 * Docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 *
 * Tip: a local server exposing the same `/images` contract can be used by just
 * pointing OPENROUTER_BASE_URL at it.
 */
export class OpenRouterImageProvider implements ImageProvider {
  readonly id = 'openrouter';
  readonly capabilities = {
    maxReferenceImages: 4,
    nativeInpainting: false,
    aspectRatios: [...ASPECT_RATIOS, 'auto'] as const,
    seed: true,
  };
  private readonly logger = new Logger(OpenRouterImageProvider.name);

  constructor(
    readonly model: string,
    private readonly cfg: AppConfig['openrouter'],
  ) {}

  readiness() {
    return this.cfg.apiKey ? null : 'OPENROUTER_API_KEY is not set. Add it to the .env file at the repository root and restart.';
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const notReady = this.readiness();
    if (notReady) throw new ProviderError(notReady, false);

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
      seed: req.seed,
      output_format: 'png',
    };
    if (req.referenceImages.length) {
      body.input_references = req.referenceImages.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}` },
      }));
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/images`, {
        method: 'POST',
        signal: req.signal,
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Imagegen Studio',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (req.signal.aborted) throw err;
      throw new ProviderError(`Network error contacting OpenRouter: ${(err as Error).message}`, true);
    }

    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 500);
      try {
        const json = JSON.parse(text);
        message = json?.error?.message ?? json?.message ?? message;
        const raw = json?.error?.metadata?.raw;
        if (raw && typeof raw === 'string') message += ` (${raw.slice(0, 300)})`;
      } catch {
        /* not JSON */
      }
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      throw new ProviderError(`OpenRouter ${res.status}: ${message}`, retryable, res.status);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError('OpenRouter returned an invalid JSON response', true);
    }
    const image = json?.data?.[0];
    if (!image?.b64_json) {
      throw new ProviderError('OpenRouter returned no image (the prompt may have been filtered)', false);
    }
    this.logger.debug(`Generated image in ${Date.now() - started}ms`);
    return {
      data: Buffer.from(image.b64_json, 'base64'),
      mime: image.media_type ?? 'image/png',
      meta: { cost: json?.usage?.cost, durationMs: Date.now() - started },
    };
  }
}
