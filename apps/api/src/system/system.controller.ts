import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { config } from '../config.js';
import { QueueService } from '../generations/queue.service.js';
import { IMAGE_PROVIDER, type ImageProvider, modelOrDefault, TEXT_PROVIDER, type TextProvider, UPSCALE_PROVIDER, type UpscaleProvider } from '../providers/types.js';

@ApiTags('system')
@Controller()
export class SystemController {
  constructor(
    @Inject(IMAGE_PROVIDER) private readonly image: ImageProvider,
    @Inject(TEXT_PROVIDER) private readonly text: TextProvider,
    @Inject(UPSCALE_PROVIDER) private readonly upscale: UpscaleProvider,
    private readonly queue: QueueService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness check' })
  health() {
    return { ok: true };
  }

  @Get('config')
  @ApiOperation({ summary: 'Active providers, capabilities and readiness' })
  info() {
    const def = modelOrDefault(this.image);
    const issues = [this.image.readiness(), this.text.readiness()].filter((x): x is string => !!x);
    return {
      ready: issues.length === 0,
      issues: [...new Set(issues)],
      image: {
        provider: this.image.id,
        /** Default model id; the client may pick any of `models` per generation. */
        model: def.id,
        capabilities: def.capabilities,
        models: this.image.models.map(({ id, label, description, capabilities }) => ({ id, label, description, capabilities })),
        /** LoRAs and the models each one supports; `issue` says why one can't be used right now (null when it can). */
        loras: (this.image.loras ?? []).map((l) => ({ ...l, issue: this.image.loraIssue?.(l.id) ?? null })),
      },
      text: { provider: this.text.id, model: this.text.model },
      upscale: {
        provider: this.upscale.id,
        default: this.upscale.defaultUpscaler,
        /** `issue` explains why an upscaler can't run right now (null when it can). */
        upscalers: this.upscale.upscalers.map((u) => ({ ...u, issue: this.upscale.readiness(u.id) })),
      },
      queue: this.queue.stats(),
      limits: { maxVariants: 8, maxInputImages: Math.max(...this.image.models.map((m) => m.capabilities.maxReferenceImages)) },
      authRequired: !!config.apiToken,
    };
  }
}
