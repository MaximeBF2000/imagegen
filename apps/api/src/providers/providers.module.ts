import { Global, Module } from '@nestjs/common';
import { config } from '../config.js';
import { createImageProvider, createTextProvider, createUpscaleProvider } from './registry.js';
import { IMAGE_PROVIDER, TEXT_PROVIDER, UPSCALE_PROVIDER } from './types.js';

@Global()
@Module({
  providers: [
    { provide: IMAGE_PROVIDER, useFactory: () => createImageProvider(config) },
    { provide: TEXT_PROVIDER, useFactory: () => createTextProvider(config) },
    { provide: UPSCALE_PROVIDER, useFactory: () => createUpscaleProvider(config) },
  ],
  exports: [IMAGE_PROVIDER, TEXT_PROVIDER, UPSCALE_PROVIDER],
})
export class ProvidersModule {}
