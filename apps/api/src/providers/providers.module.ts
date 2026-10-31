import { Global, Module } from '@nestjs/common';
import { config } from '../config.js';
import { createImageProvider, createTextProvider } from './registry.js';
import { IMAGE_PROVIDER, TEXT_PROVIDER } from './types.js';

@Global()
@Module({
  providers: [
    { provide: IMAGE_PROVIDER, useFactory: () => createImageProvider(config) },
    { provide: TEXT_PROVIDER, useFactory: () => createTextProvider(config) },
  ],
  exports: [IMAGE_PROVIDER, TEXT_PROVIDER],
})
export class ProvidersModule {}
