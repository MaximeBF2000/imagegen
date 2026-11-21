import type { Lora } from './types.js';

/**
 * LoRAs served by the local inference server (apps/inference/loras.py).
 * The ids must match the `LORAS` registry there (which knows where each file lives and
 * how to download it); to add one, add an entry in both places.
 *
 * `models` is the model → LoRA mapping: a LoRA only shows up in the picker, and is only
 * accepted by the API, for the models listed here (LoRAs only work on the architecture
 * they were trained on). `qwen-image-2.1` is the base model most LoRAs were trained on;
 * the Turbo model runs them too, a bit less faithfully.
 */
const QWEN = ['qwen-image-2.1-turbo', 'qwen-image-2.1'];

export const LOCAL_LORAS: Lora[] = [
  {
    id: 'candid-amateur-iphone-qwen21',
    label: 'Candid Amateur iPhone',
    description: 'Plain phone-photo look: everyday light, natural skin with pores and freckles, real rooms, casual moments.',
    models: QWEN,
    trigger: 'cndamiph',
    defaultScale: 1,
    source: 'https://civitai.com/models/3012015',
  },
  {
    id: 'lenovo-ultrareal-qwen21',
    label: 'Lenovo UltraReal',
    description: 'General photorealism: real-camera skin, light and color, less of the "AI look".',
    models: QWEN,
    defaultScale: 0.8,
    usage: 'No trigger word. 0.8 is the author’s setting; stacks well with other realism LoRAs.',
    source: 'https://civitai.com/models/1662740',
  },
  {
    id: 'detailifier-qwen21',
    label: 'Detailifier',
    description: 'More detail in faces, skin, clothing, fur and materials.',
    models: QWEN,
    defaultScale: 0.6,
    usage: 'Works on any image, alone or on top of a style. Author’s range is 0.2–1; strongest on large images.',
    source: 'https://civitai.com/models/430687',
  },
  {
    id: 'anime-fusal-qwen21',
    label: 'Anime FUSAL',
    description: 'Anime illustration in 5 looks: flat cel, clean modern cel, semi-impasto, painterly gouache, ink-and-watercolor.',
    models: ['qwen-image-2.1'],
    trigger: 'fusal style.',
    defaultScale: 0.7,
    usage:
      'Best with the structured prompt (insert it below). Pick a look by starting [Subject] with e.g. "Crisp flat cel-shaded anime illustration;", ' +
      '"Luminous clean cel-shaded…", "Luminous semi-impasto…", "Sunlit painterly gouache…" or "Delicate ink-and-wash…". Strength 0.7–1.',
    promptTemplate: [
      '[TASK: TEXT_TO_IMAGE]',
      '[Subject] Luminous clean cel-shaded anime illustration; ',
      '[Appearance] ',
      '[Pose] ',
      '[Composition] ',
      '[Environment] ',
      '[Lighting] ',
      '[Style] Crisp linework, clear cel shadow boundaries with smooth gradients, luminous rim highlights.',
    ].join('\n'),
    source: 'https://huggingface.co/MicksHF/Qwen-Image-2.1-Anime-Fusal',
  },
  {
    id: 'anime-fusal-turbo-qwen21',
    label: 'Anime FUSAL (Turbo preview)',
    description: 'The author’s Turbo version of Anime FUSAL. Faster, but a preview: weaker style than the base-model version.',
    models: ['qwen-image-2.1-turbo'],
    trigger: 'fusal style.',
    defaultScale: 0.7,
    usage: 'For the full-quality version, switch to the Qwen-Image 2.1 model. Same structured prompt; strength 0.7–1.',
    promptTemplate: [
      '[TASK: TEXT_TO_IMAGE]',
      '[Subject] Luminous clean cel-shaded anime illustration; ',
      '[Appearance] ',
      '[Pose] ',
      '[Composition] ',
      '[Environment] ',
      '[Lighting] ',
      '[Style] Crisp linework, clear cel shadow boundaries with smooth gradients, luminous rim highlights.',
    ].join('\n'),
    source: 'https://huggingface.co/MicksHF/Qwen-Image-2.1-Anime-Fusal',
  },
  {
    id: 'consistency-qwen21',
    label: 'Consistency (edits)',
    description: 'Edits keep the original framing pixel-for-pixel: nothing shifts, resizes or gets repainted that you didn’t ask for.',
    models: QWEN,
    defaultScale: 1,
    needsImage: true,
    usage: 'Add your picture as a reference, set the ratio to Match input, and write the edit ("make it a watercolor painting", "make the cardigan navy"). Strength 1.',
    source: 'https://civitai.com/models/2969143',
  },
  {
    id: 'character-sheet-qwen21',
    label: 'Character Sheet',
    description: 'One photo of a person → a 3×2 sheet on grey: face close-up plus five full-body angles (or poses), same outfit.',
    models: ['qwen-image-2.1'],
    defaultScale: 1,
    needsImage: true,
    usage:
      'Reference: a standing photo, head to at least mid-thigh. Use the prompt as is (swap "her" for "his" if needed), ratio 3:2. ' +
      'Keep strength at 1 (lower leaves empty boxes). A box looks off? Run again.',
    promptTemplate:
      'turn this photo into a character reference sheet: a 3x2 grid on a plain grey background with a close-up portrait of her face, ' +
      'then her full outfit from the front, back, side, three-quarter front and three-quarter back, cropped at the neck',
    source: 'https://civitai.com/models/2995608',
  },
  {
    id: 'deblur-qwen21',
    label: 'Deblur anything',
    description: 'Removes blur, even heavy blur, from a reference image. Not for bokeh or partly blurred photos.',
    models: QWEN,
    trigger: 'Wibble snargle floof',
    defaultScale: 1,
    needsImage: true,
    usage: 'Add the blurry image as a reference, ratio Match input. The prompt is just the (nonsense) trigger, added for you. Best on the base model.',
    promptTemplate: 'Wibble snargle floof',
    source: 'https://civitai.com/models/2975487',
  },
  {
    id: 'image-blend-fusion-qwen21',
    label: 'Image Blend Fusion',
    description: 'Blends a roughly pasted cut-out (object, person, car…) into the picture: lighting, shadows, edges and perspective.',
    models: QWEN,
    defaultScale: 1,
    needsImage: true,
    usage: 'Reference: one image where you already pasted the cut-out. Prompt: "Blend the <thing> into the <place> seamlessly". Ratio Match input.',
    promptTemplate: 'Blend the object into the image seamlessly',
    source: 'https://civitai.com/models/2548669',
  },
];
