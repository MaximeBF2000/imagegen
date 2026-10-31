import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { PromptsModule } from '../prompts/prompts.module.js';
import { EventsService } from './events.service.js';
import { GenerationRunner } from './generation-runner.service.js';
import { GenerationsController } from './generations.controller.js';
import { GenerationsService } from './generations.service.js';
import { QueueService } from './queue.service.js';

@Module({
  imports: [AssetsModule, PromptsModule],
  controllers: [GenerationsController],
  providers: [EventsService, GenerationRunner, QueueService, GenerationsService],
  exports: [QueueService, GenerationsService, EventsService],
})
export class GenerationsModule {}
