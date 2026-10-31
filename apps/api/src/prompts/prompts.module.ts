import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { PromptEnhancerService } from './prompt-enhancer.service.js';
import { PromptsController } from './prompts.controller.js';

@Module({
  imports: [AssetsModule],
  controllers: [PromptsController],
  providers: [PromptEnhancerService],
  exports: [PromptEnhancerService],
})
export class PromptsModule {}
