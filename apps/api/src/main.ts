import 'reflect-metadata';
import { config } from './config.js';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    // Long-lived SSE connections would otherwise block shutdown (and dev restarts).
    forceCloseConnections: true,
  });
  // Larger JSON bodies so automations can send inline base64 images.
  app.useBodyParser('json', { limit: '60mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map((s) => s.trim()),
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Imagegen Studio API')
    .setDescription(
      'Programmatic access to the image generation queue: upload images, queue generations (text-to-image, ' +
        'image-to-image, inpainting), enhance prompts, and follow progress via SSE or long-polling.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), {
    jsonDocumentUrl: 'api/openapi.json',
  });

  await app.listen(config.port);
  const log = new Logger('Bootstrap');
  log.log(`API ready on ${config.publicUrl}/api  —  docs: ${config.publicUrl}/api/docs`);
}

void bootstrap();
