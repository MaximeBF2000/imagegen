import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssetsModule } from './assets/assets.module.js';
import { ApiTokenGuard } from './common/auth.guard.js';
import { DbModule } from './db/db.module.js';
import { FoldersModule } from './folders/folders.module.js';
import { GenerationsModule } from './generations/generations.module.js';
import { PromptsModule } from './prompts/prompts.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { SystemController } from './system/system.controller.js';

@Module({
  imports: [DbModule, ProvidersModule, AssetsModule, PromptsModule, GenerationsModule, FoldersModule],
  controllers: [SystemController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule {}
