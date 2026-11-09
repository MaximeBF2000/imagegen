import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';
import {
  ASPECT_RATIOS,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageProvider,
  type TextCompletionRequest,
  type TextProvider,
} from './types.js';

/**
 * Offline providers used for development, demos and tests (IMAGE_PROVIDER=mock).
 * They also serve as the smallest possible example of a provider implementation.
 */
export class MockImageProvider implements ImageProvider {
  readonly id = 'mock';
  readonly defaultModel = 'mock-gradient';
  readonly models = [
    {
      id: 'mock-gradient',
      label: 'Mock gradient',
      capabilities: { maxReferenceImages: 4, nativeInpainting: false, aspectRatios: [...ASPECT_RATIOS, 'auto'] as const, seed: true },
    },
    {
      id: 'mock-gradient-alt',
      label: 'Mock gradient (alt)',
      capabilities: { maxReferenceImages: 2, nativeInpainting: false, aspectRatios: [...ASPECT_RATIOS, 'auto'] as const, seed: true },
    },
  ];

  constructor(private readonly delayMs = 2500) {}

  readiness() {
    return null;
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    await sleep(this.delayMs * (0.6 + ((req.seed % 100) / 100) * 0.8), undefined, { signal: req.signal });
    if (/\bfail\b/i.test(req.prompt)) throw new Error('Mock failure requested by prompt');

    const { width, height } = req.width && req.height ? req : { width: 1024, height: 1024 };
    const hue = req.seed % 360;
    const words = req.prompt.replace(/[<>&"]/g, '').split(/\s+/).slice(0, 6).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 120) % 360},70%,30%)"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${width * 0.7}" cy="${height * 0.35}" r="${Math.min(width, height) * 0.18}" fill="hsla(${(hue + 60) % 360},90%,70%,0.6)"/>
      <text x="50%" y="88%" font-family="Helvetica, Arial" font-size="${Math.round(width / 26)}" fill="white" text-anchor="middle" opacity="0.85">${words}</text>
      <text x="50%" y="94%" font-family="Helvetica, Arial" font-size="${Math.round(width / 50)}" fill="white" text-anchor="middle" opacity="0.6">seed ${req.seed}</text>
    </svg>`;

    let img = sharp(Buffer.from(svg));
    const ref = req.referenceImages[0];
    if (ref) {
      // Blend the first reference in so image-to-image / inpainting flows are visible.
      const base = await sharp(ref.data).resize(width, height, { fit: 'cover' }).png().toBuffer();
      const overlay = await sharp(Buffer.from(svg)).ensureAlpha(0.45).png().toBuffer();
      img = sharp(base).composite([{ input: overlay, blend: 'over' }]);
    }
    return { data: await img.png().toBuffer(), mime: 'image/png', meta: { mock: true, model: req.model } };
  }
}

export class MockTextProvider implements TextProvider {
  readonly id = 'mock';
  readonly model = 'mock-llm';

  readiness() {
    return null;
  }

  async complete(req: TextCompletionRequest): Promise<string> {
    await sleep(600);
    const idea = req.user.replace(/^[\s\S]*?User idea:\s*/i, '').split('\n')[0].trim() || req.user.trim();
    return `${idea.charAt(0).toUpperCase()}${idea.slice(1)}, cinematic composition, soft volumetric light, rich color palette, shallow depth of field, highly detailed textures, shot on a 35mm lens`;
  }
}
