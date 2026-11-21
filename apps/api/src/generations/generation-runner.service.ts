import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { AssetsService } from '../assets/assets.service.js';
import { DatabaseService, type GenerationRow, type JobRow } from '../db/database.service.js';
import { PromptEnhancerService } from '../prompts/prompt-enhancer.service.js';
import {
  type AspectRatio,
  dimensionsFor,
  IMAGE_PROVIDER,
  type ImageProvider,
  type InputImage,
  type LoraRef,
  lorasFor,
  modelOrDefault,
  withTriggers,
  UPSCALE_PROVIDER,
  type UpscaleProvider,
} from '../providers/types.js';
import { EventsService } from './events.service.js';

/**
 * Executes a single job: resolves the prompt (optional LLM enhancement, done once
 * per generation), loads inputs, calls the image provider and stores the result.
 */
@Injectable()
export class GenerationRunner {
  private readonly logger = new Logger(GenerationRunner.name);
  private readonly enhancing = new Map<string, Promise<string>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly assets: AssetsService,
    private readonly enhancer: PromptEnhancerService,
    private readonly events: EventsService,
    @Inject(IMAGE_PROVIDER) private readonly provider: ImageProvider,
    @Inject(UPSCALE_PROVIDER) private readonly upscaler: UpscaleProvider,
  ) {}

  async run(job: JobRow, signal: AbortSignal): Promise<{ assetId: string; meta?: Record<string, unknown> }> {
    const gen = this.db.get<GenerationRow>('SELECT * FROM generations WHERE id = ?', job.generation_id);
    if (!gen) throw new Error('Generation was deleted');

    const inputIds: string[] = JSON.parse(gen.input_ids);
    if (gen.upscale) {
      const { upscaler, scale } = JSON.parse(gen.upscale) as { upscaler: string; scale: number };
      const image = await this.assets.readInput(inputIds[0]);
      const res = await this.upscaler.upscale({ upscaler, image, scale, seed: job.seed, signal });
      const asset = await this.assets.save(res.data, 'generated');
      return { assetId: asset.id, meta: { ...res.meta, upscaledFrom: { width: image.width, height: image.height } } };
    }
    const loras: LoraRef[] = gen.loras ? JSON.parse(gen.loras) : [];
    const prompt = await this.resolvePrompt(gen, inputIds);
    const inputs: InputImage[] = [];
    for (const id of inputIds) inputs.push(await this.assets.readInput(id));

    const ratio = gen.aspect_ratio as AspectRatio | 'auto';
    const { width, height } = dimensionsFor(ratio, inputs[0]);
    const model = modelOrDefault(this.provider, gen.model);
    const caps = model.capabilities;
    const base = { model: model.id, aspectRatio: ratio, width, height, seed: job.seed, loras, signal };
    // LoRA trigger words go first in the prompt, as they were trained.
    const enabled = lorasFor(this.provider, model.id).filter((l) => loras.some((r) => r.id === l.id));
    const triggered = (text: string) => withTriggers(text, enabled);

    let output: Buffer;
    let meta: Record<string, unknown> | undefined;

    if (gen.mask_id && inputs[0]) {
      const source = inputs[0];
      const mask = await this.normalizedMask(gen.mask_id, source);
      if (caps.nativeInpainting) {
        const res = await this.provider.generate({
          ...base,
          prompt: triggered(prompt),
          referenceImages: inputs.slice(1),
          inpaint: { image: source, mask },
        });
        // Composite anyway: the VAE round-trip slightly alters pixels outside the mask.
        output = await this.compositeThroughMask(source, res.data, mask);
        meta = { ...res.meta, inpaint: 'native' };
      } else {
        // Emulated inpainting: show the model the area to change, then composite
        // the result through the (feathered) mask so pixels outside stay untouched.
        const marked = await this.markedImage(source, mask);
        const res = await this.provider.generate({
          ...base,
          aspectRatio: 'auto',
          ...dimensionsFor('auto', source),
          prompt: triggered(
            `Edit the first image. The second image is the exact same picture where the region to modify is highlighted in red. ` +
            `Inside the highlighted region only: ${prompt}. ` +
            `Everything outside the highlighted region must remain identical to the first image. The final image must not contain any red highlight.`,
          ),
          referenceImages: [source, marked, ...inputs.slice(1)].slice(0, caps.maxReferenceImages),
        });
        output = await this.compositeThroughMask(source, res.data, mask);
        meta = { ...res.meta, inpaint: 'emulated' };
      }
    } else {
      const res = await this.provider.generate({
        ...base,
        prompt: triggered(prompt),
        referenceImages: inputs.slice(0, caps.maxReferenceImages),
      });
      output = res.data;
      meta = res.meta;
    }

    const asset = await this.assets.save(output, 'generated');
    return { assetId: asset.id, meta };
  }

  /** Enhance once per generation, shared between its parallel jobs. */
  private async resolvePrompt(gen: GenerationRow, inputIds: string[]): Promise<string> {
    if (!gen.enhance) return gen.prompt;
    if (gen.enhanced_prompt) return gen.enhanced_prompt;
    let pending = this.enhancing.get(gen.id);
    if (!pending) {
      pending = (async () => {
        try {
          const mode = gen.mask_id ? 'inpaint' : inputIds.length ? 'edit' : 'generate';
          const enhanced = await this.enhancer.enhance(gen.prompt, { mode, imageIds: inputIds });
          this.db.run('UPDATE generations SET enhanced_prompt = ? WHERE id = ?', enhanced, gen.id);
          this.events.generationChanged(gen.id);
          return enhanced;
        } catch (err) {
          this.logger.warn(`Prompt enhancement failed, using original prompt: ${(err as Error).message}`);
          return gen.prompt;
        } finally {
          setTimeout(() => this.enhancing.delete(gen.id), 60_000);
        }
      })();
      this.enhancing.set(gen.id, pending);
    }
    return pending;
  }

  /**
   * Mask as a single-channel PNG resized to the source image.
   * (Each sharp step below is its own pipeline: sharp reorders operations like
   * removeAlpha after joinChannel within a single pipeline.)
   */
  private async normalizedMask(maskId: string, source: InputImage): Promise<Buffer> {
    const mask = await this.assets.readInput(maskId);
    const raw = await this.rawMask(mask.data, source.width, source.height);
    return sharp(raw, { raw: { width: source.width, height: source.height, channels: 1 } }).png().toBuffer();
  }

  private async rawMask(mask: Buffer, width: number, height: number, blur = 0): Promise<Buffer> {
    const resized = await sharp(mask).resize(width, height, { fit: 'fill' }).flatten({ background: '#000' }).extractChannel(0).raw().toBuffer();
    if (!blur) return resized;
    return sharp(resized, { raw: { width, height, channels: 1 } }).blur(blur).extractChannel(0).raw().toBuffer();
  }

  private async markedImage(source: InputImage, mask: Buffer): Promise<InputImage> {
    const { width, height } = source;
    const alpha = await this.rawMask(mask, width, height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(alpha[i] * 0.6);
    const red = await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 40 } } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const data = await sharp(source.data).composite([{ input: red }]).png().toBuffer();
    return { data, mime: 'image/png', width, height };
  }

  private async compositeThroughMask(source: InputImage, generated: Buffer, mask: Buffer): Promise<Buffer> {
    const { width, height } = source;
    const feather = Math.max(1.5, Math.min(width, height) / 160);
    const alpha = await this.rawMask(mask, width, height, feather);
    const rgb = await sharp(generated).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const patch = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    return sharp(source.data).composite([{ input: patch }]).png().toBuffer();
  }
}
