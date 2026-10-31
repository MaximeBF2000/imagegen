import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { config } from '../config.js';
import { QueueService } from '../generations/queue.service.js';
import { IMAGE_PROVIDER, type ImageProvider, TEXT_PROVIDER, type TextProvider } from '../providers/types.js';

@ApiTags('system')
@Controller()
export class SystemController {
  constructor(
    @Inject(IMAGE_PROVIDER) private readonly image: ImageProvider,
    @Inject(TEXT_PROVIDER) private readonly text: TextProvider,
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
    const issues = [this.image.readiness(), this.text.readiness()].filter((x): x is string => !!x);
    return {
      ready: issues.length === 0,
      issues: [...new Set(issues)],
      image: { provider: this.image.id, model: this.image.model, capabilities: this.image.capabilities },
      text: { provider: this.text.id, model: this.text.model },
      queue: this.queue.stats(),
      limits: { maxVariants: 8, maxInputImages: this.image.capabilities.maxReferenceImages },
      authRequired: !!config.apiToken,
    };
  }
}
