import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { GenerationsModule } from '../generations/generations.module.js';
import { FoldersController } from './folders.controller.js';
import { FoldersService } from './folders.service.js';

@Module({
  imports: [AssetsModule, GenerationsModule],
  controllers: [FoldersController],
  providers: [FoldersService],
})
export class FoldersModule {}
