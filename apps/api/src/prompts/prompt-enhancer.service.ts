import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AssetsService } from '../assets/assets.service.js';
import { type InputImage, TEXT_PROVIDER, type TextProvider } from '../providers/types.js';

export type EnhanceMode = 'generate' | 'edit' | 'inpaint';

const BASE_RULES = `You are an expert prompt engineer for FLUX.2, a state-of-the-art diffusion image model.
FLUX.2 understands natural language best: write flowing descriptive prose, not tag lists or keyword soup.

Guidelines:
- Lead with the main subject and action, then setting, then composition/camera, then lighting, then style/mood.
- Be concrete and visual: materials, colors, textures, time of day, lens/framing (e.g. "35mm, shallow depth of field") when photographic.
- Keep the user's intent, subject, and any explicit details or quoted text EXACTLY. Never contradict them.
- Infer a fitting style if none is given (photo, illustration, 3D render...), and make it explicit.
- Text that must appear in the image goes in double quotes.
- No negative prompts ("no X"), no weights, no parameters, no markdown.
- 40 to 110 words. Same language as the user.

Output ONLY the final prompt, nothing else.`;

const MODE_RULES: Record<EnhanceMode, string> = {
  generate: '',
  edit: `
The user is EDITING / using the attached reference image(s). Write an edit instruction: state precisely what to change and
explicitly say what must stay the same (identity, pose, composition, lighting, style) unless the user wants it changed.
Refer to references as "the first image", "the second image" when several are attached.`,
  inpaint: `
The user is INPAINTING a masked region of the attached image. Describe only what should appear inside the masked region
and how it should blend seamlessly with the surrounding scene (matching lighting, perspective, color grading, grain).`,
};

@Injectable()
export class PromptEnhancerService {
  constructor(
    @Inject(TEXT_PROVIDER) private readonly llm: TextProvider,
    private readonly assets: AssetsService,
  ) {}

  async enhance(prompt: string, opts: { mode?: EnhanceMode; imageIds?: string[]; signal?: AbortSignal } = {}) {
    const mode = opts.mode ?? (opts.imageIds?.length ? 'edit' : 'generate');
    const images: InputImage[] = [];
    for (const id of (opts.imageIds ?? []).slice(0, 4)) {
      images.push(await this.preview(await this.assets.readInput(id)));
    }
    const out = await this.llm.complete({
      system: BASE_RULES + MODE_RULES[mode],
      user: `User idea: ${prompt.trim()}`,
      images,
      temperature: 0.7,
      signal: opts.signal,
    });
    return out
      .replace(/^```[a-z]*\s*|\s*```$/g, '')
      .replace(/^(prompt|enhanced prompt)\s*:\s*/i, '')
      .replace(/^["“](.*)["”]$/s, '$1')
      .trim();
  }

  /** Downscale references before sending them to the LLM (cheaper, faster). */
  private async preview(img: InputImage): Promise<InputImage> {
    const data = await sharp(img.data).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { data, mime: 'image/jpeg', width: 768, height: 768 };
  }
}
