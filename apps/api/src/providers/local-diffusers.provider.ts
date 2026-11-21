import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { LOCAL_LORAS } from './loras.js';
import { LOCAL_MODELS } from './models.js';
import { LOCAL_UPSCALERS } from './upscalers.js';
import {
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageProvider,
  modelOrDefault,
  ProviderError,
  type TextCompletionRequest,
  type TextProvider,
  type UpscaleProvider,
  type UpscaleRequest,
} from './types.js';

interface Health {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Catalog id of the loaded model (or the one being loaded). */
  model: string;
  device: string;
  /** `issue` is null when the upscaler can run. */
  upscalers?: { id: string; issue: string | null }[];
  /** `issue` is null when the LoRA file is there. */
  loras?: { id: string; issue: string | null }[];
}

const labelOf = (id?: string) => LOCAL_MODELS.find((m) => m.id === id)?.label ?? id ?? 'the model';

/**
 * Tracks the Python inference server's state (apps/inference) so readiness()
 * can answer synchronously. Shared by the image and text providers.
 */
class InferenceServer {
  private static instances = new Map<string, InferenceServer>();
  private readonly logger = new Logger('InferenceServer');
  health: Health | null = null;
  reachable = false;
  private lastStatus = '';

  static for(url: string) {
    let s = InferenceServer.instances.get(url);
    if (!s) InferenceServer.instances.set(url, (s = new InferenceServer(url)));
    return s;
  }

  private constructor(readonly url: string) {
    void this.poll();
    setInterval(() => void this.poll(), 3000).unref();
  }

  private failures = 0;

  private async poll() {
    try {
      const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(5000) });
      this.health = (await res.json()) as Health;
      this.reachable = true;
      this.failures = 0;
    } catch {
      // A single slow answer while the GPU is busy isn't an outage.
      if (++this.failures >= 2) {
        this.reachable = false;
        this.health = null;
      }
    }
    const status = this.reachable ? this.health!.status : 'unreachable';
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      const detail = this.health?.device ? ` (${this.health.model} on ${this.health.device})` : '';
      this.logger.log(`Inference server at ${this.url}: ${status}${detail}`);
    }
  }

  readiness(): string | null {
    if (!this.reachable) {
      return `The local inference server isn't running at ${this.url}. Start everything with "pnpm dev" (or "pnpm --filter inference dev").`;
    }
    if (this.health?.status === 'loading') return `Loading ${labelOf(this.health.model)} into memory…`;
    if (this.health?.status === 'error') return `The model failed to load: ${this.health.error}`;
    return null;
  }

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ProviderError(`Inference server unreachable at ${this.url}: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      let message = await res.text();
      try {
        message = JSON.parse(message).detail ?? message;
      } catch {
        /* plain text */
      }
      // 503 = model still loading: worth retrying.
      throw new ProviderError(`Inference ${res.status}: ${String(message).slice(0, 400)}`, res.status === 503 || res.status >= 502, res.status);
    }
    return res;
  }
}

const toBase64 = (data: Buffer) => data.toString('base64');

/**
 * Local models (FLUX.2 klein, Qwen-Image…) running through Hugging Face diffusers
 * (apps/inference/server.py). The server keeps one model in memory and swaps it
 * when a job asks for another one.
 */
export class LocalImageProvider implements ImageProvider {
  readonly id = 'local';
  readonly models = LOCAL_MODELS;
  readonly loras = LOCAL_LORAS;
  readonly defaultModel: string;
  private readonly server: InferenceServer;

  constructor(defaultModel: string, url: string) {
    this.defaultModel = modelOrDefault(this, defaultModel).id;
    this.server = InferenceServer.for(url);
  }

  readiness() {
    return this.server.readiness();
  }

  loraIssue(id: string) {
    if (!this.server.reachable) return null; // unknown until the server is up; the job reports it then
    const entry = this.server.health?.loras?.find((l) => l.id === id);
    return entry ? entry.issue : 'The inference server doesn’t know this LoRA (restart it to pick up new ones).';
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const requestId = randomUUID();
    const onAbort = () => void this.server.post(`/cancel/${requestId}`, {}).catch(() => undefined);
    req.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.server.post(
        '/generate',
        {
          model: req.model,
          prompt: req.prompt,
          width: req.width,
          height: req.height,
          seed: req.seed,
          references: req.referenceImages.map((img) => toBase64(img.data)),
          inpaint: req.inpaint ? { image: toBase64(req.inpaint.image.data), mask: toBase64(req.inpaint.mask) } : undefined,
          loras: req.loras ?? [],
          request_id: requestId,
        },
        req.signal,
      );
      const seconds = Number(res.headers.get('x-inference-seconds'));
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mime: 'image/png',
        meta: {
          durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined,
          device: this.server.health?.device,
          loadMs: Number(res.headers.get('x-load-seconds')) * 1000 || undefined,
        },
      };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Upscalers run by the inference server (apps/inference/upscalers.py), e.g.
 * SeedVR2 through mlx-gen. GPU work is serialized with image generations there.
 */
export class LocalUpscaleProvider implements UpscaleProvider {
  readonly id = 'local';
  readonly upscalers = LOCAL_UPSCALERS;
  readonly defaultUpscaler: string;
  private readonly server: InferenceServer;

  constructor(defaultUpscaler: string, url: string) {
    this.defaultUpscaler = LOCAL_UPSCALERS.find((u) => u.id === defaultUpscaler)?.id ?? LOCAL_UPSCALERS[0].id;
    this.server = InferenceServer.for(url);
  }

  readiness(upscaler = this.defaultUpscaler) {
    if (!this.server.reachable) return this.server.readiness();
    return this.server.health?.upscalers?.find((u) => u.id === upscaler)?.issue ?? null;
  }

  async upscale(req: UpscaleRequest): Promise<ImageGenerationResult> {
    const requestId = randomUUID();
    const onAbort = () => void this.server.post(`/cancel/${requestId}`, {}).catch(() => undefined);
    req.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.server.post(
        '/upscale',
        { upscaler: req.upscaler, image: toBase64(req.image.data), scale: req.scale, seed: req.seed, request_id: requestId },
        req.signal,
      );
      const seconds = Number(res.headers.get('x-inference-seconds'));
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mime: 'image/png',
        meta: { durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined, device: this.server.health?.device },
      };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Prompt enhancer using the loaded image model's own text encoder (Qwen3 for
 * FLUX.2 klein, Qwen3-VL for Qwen-Image, both full causal LMs) through the
 * inference server: no extra model to download or keep in memory. Text only.
 */
export class LocalTextProvider implements TextProvider {
  readonly id = 'local';
  readonly model = 'Qwen3 (the image model’s text encoder)';
  private readonly server: InferenceServer;

  constructor(url: string) {
    this.server = InferenceServer.for(url);
  }

  readiness() {
    return this.server.readiness();
  }

  async complete(req: TextCompletionRequest): Promise<string> {
    const res = await this.server.post(
      '/enhance',
      { system: req.system, user: req.user, temperature: req.temperature ?? 0.7 },
      req.signal,
    );
    const { text } = (await res.json()) as { text: string };
    if (!text?.trim()) throw new ProviderError('The local LLM returned an empty response', true);
    return text.trim();
  }
}
