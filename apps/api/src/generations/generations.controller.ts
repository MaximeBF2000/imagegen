import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { concatMap, from, interval, map, merge, type Observable, of } from 'rxjs';
import { EventsService } from './events.service.js';
import { BulkCreateGenerationsDto, CreateGenerationDto, ListGenerationsQuery, MoveImagesDto, UpdateGenerationDto } from './generations.dto.js';
import { GenerationsService } from './generations.service.js';
import { QueueService } from './queue.service.js';

@ApiTags('generations')
@Controller()
export class GenerationsController {
  constructor(
    private readonly generations: GenerationsService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
  ) {}

  @Post('generations')
  @ApiOperation({
    summary: 'Queue a generation',
    description:
      'Creates a generation with `count` variants. Returns immediately (jobs are processed asynchronously). ' +
      'Text-to-image with only a prompt; image-to-image with input images; inpainting with an input image + mask.',
  })
  create(@Body() dto: CreateGenerationDto) {
    return this.generations.create(dto);
  }

  @Post('generations/bulk')
  @ApiOperation({ summary: 'Queue many generations at once (automation)' })
  async bulk(@Body() dto: BulkCreateGenerationsDto) {
    const out = [];
    for (const item of dto.items) out.push(await this.generations.create(item));
    return { items: out };
  }

  @Get('generations')
  @ApiOperation({ summary: 'List generations, newest first (cursor pagination)' })
  list(@Query() query: ListGenerationsQuery) {
    return this.generations.list(query);
  }

  @Get('generations/:id')
  @ApiOperation({ summary: 'Get a generation with its jobs and images' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.get(id);
  }

  @Patch('generations/:id')
  @ApiOperation({ summary: 'Update a generation (label, or move all its images to a folder)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGenerationDto) {
    return this.generations.update(id, dto);
  }

  @Post('images/move')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move images (job ids) to a folder, or out of folders with folderId=null' })
  moveImages(@Body() dto: MoveImagesDto) {
    return this.generations.moveImages(dto.ids, dto.folderId);
  }

  @Get('generations/:id/wait')
  @ApiOperation({ summary: 'Long-poll until every job of the generation is finished (or timeout)' })
  @ApiQuery({ name: 'timeout', required: false, description: 'Seconds, max 300 (default 120)' })
  wait(@Param('id', ParseUUIDPipe) id: string, @Query('timeout') timeout?: string) {
    const seconds = Math.min(300, Math.max(1, Number(timeout) || 120));
    return this.generations.waitFor(id, seconds * 1000);
  }

  @Post('generations/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel queued/running jobs of a generation' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.cancel(id);
  }

  @Post('generations/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-queue failed/canceled jobs of a generation' })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.retry(id);
  }

  @Delete('generations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a generation and its generated images' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.generations.remove(id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a single failed/canceled job' })
  retryJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.retryJob(id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a single job' })
  cancelJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.generations.cancelJob(id);
  }

  @Delete('jobs/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a single image/job' })
  async removeJob(@Param('id', ParseUUIDPipe) id: string) {
    await this.generations.removeJob(id);
  }

  @Get('queue')
  @ApiOperation({ summary: 'Queue statistics' })
  stats() {
    return this.queue.stats();
  }

  @Sse('events')
  @ApiOperation({
    summary: 'Server-Sent Events stream',
    description: 'Emits `generation` (full generation object), `generation.deleted` ({id}), `folders` (folder list changed) and `queue` (stats) events.',
  })
  stream(): Observable<MessageEvent> {
    const updates = this.events.stream.pipe(
      concatMap((e) => {
        if (e.type === 'folders.changed') return of({ type: 'folders', data: {} } as MessageEvent);
        if (e.type === 'generation.deleted') {
          return from([
            { type: 'generation.deleted', data: { id: e.generationId } },
            { type: 'queue', data: this.queue.stats() },
          ]);
        }
        const gen = this.generations.find(e.generationId);
        const out: MessageEvent[] = [{ type: 'queue', data: this.queue.stats() }];
        if (gen) out.unshift({ type: 'generation', data: gen });
        return from(out);
      }),
    );
    const heartbeat = interval(20_000).pipe(map(() => ({ type: 'ping', data: { t: Date.now() } }) as MessageEvent));
    return merge(of({ type: 'queue', data: this.queue.stats() } as MessageEvent), updates, heartbeat);
  }
}
