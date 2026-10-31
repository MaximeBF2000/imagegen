import { randomInt, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { filter, firstValueFrom, map, race, timer } from 'rxjs';
import { type AssetDto, AssetsService } from '../assets/assets.service.js';
import { DatabaseService, type GenerationRow, type JobRow, type JobStatus } from '../db/database.service.js';
import { IMAGE_PROVIDER, type ImageProvider } from '../providers/types.js';
import { EventsService } from './events.service.js';
import type { CreateGenerationDto, ListGenerationsQuery, UpdateGenerationDto } from './generations.dto.js';
import { QueueService } from './queue.service.js';

export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface JobDto {
  id: string;
  index: number;
  status: JobStatus;
  seed: number;
  queuePosition: number | null;
  error: string | null;
  attempts: number;
  image: AssetDto | null;
  folderId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GenerationDto {
  id: string;
  prompt: string;
  enhancedPrompt: string | null;
  enhance: boolean;
  aspectRatio: string;
  count: number;
  seed: number | null;
  provider: string;
  model: string;
  mode: 'text-to-image' | 'image-to-image' | 'inpaint';
  inputImages: AssetDto[];
  mask: AssetDto | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  /** Folder the generation was created into (each image has its own `folderId`). */
  folderId: string | null;
  status: GenerationStatus;
  progress: Record<JobStatus, number>;
  jobs: JobDto[];
  createdAt: string;
}

const iso = (n: number | null) => (n ? new Date(n).toISOString() : null);

@Injectable()
export class GenerationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly assets: AssetsService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    @Inject(IMAGE_PROVIDER) private readonly provider: ImageProvider,
  ) {}

  async create(dto: CreateGenerationDto): Promise<GenerationDto> {
    const inputIds = [...(dto.inputImageIds ?? [])];
    for (const img of dto.inputImages ?? []) inputIds.push((await this.assets.saveFromString(img)).id);
    let maskId = dto.maskId ?? null;
    if (dto.mask) maskId = (await this.assets.saveFromString(dto.mask, 'mask')).id;

    const missing = inputIds.filter((id) => !this.assets.find(id));
    if (missing.length) throw new BadRequestException(`Unknown input image id(s): ${missing.join(', ')}`);
    if (maskId && !this.assets.find(maskId)) throw new BadRequestException(`Unknown mask id: ${maskId}`);
    if (maskId && !inputIds.length) throw new BadRequestException('Inpainting needs an input image (the mask applies to the first one)');
    if (dto.folderId) this.assertFolder(dto.folderId);

    const maxRefs = this.provider.capabilities.maxReferenceImages - (maskId && !this.provider.capabilities.nativeInpainting ? 1 : 0);
    if (inputIds.length > maxRefs) {
      throw new BadRequestException(`This model accepts at most ${maxRefs} input image(s)${maskId ? ' when inpainting' : ''}`);
    }

    const count = dto.count ?? 1;
    const now = Date.now();
    const gen: GenerationRow = {
      id: randomUUID(),
      prompt: dto.prompt.trim(),
      enhanced_prompt: null,
      enhance: dto.enhance ? 1 : 0,
      aspect_ratio: dto.aspectRatio ?? (inputIds.length ? 'auto' : '1:1'),
      count,
      seed: dto.seed ?? null,
      provider: this.provider.id,
      model: this.provider.model,
      input_ids: JSON.stringify(inputIds),
      mask_id: maskId,
      label: dto.label?.trim() || null,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      folder_id: dto.folderId ?? null,
      created_at: now,
    };
    const baseSeed = dto.seed ?? randomInt(0, 2_000_000_000);
    const jobIds: string[] = [];

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO generations (id, prompt, enhanced_prompt, enhance, aspect_ratio, count, seed, provider, model, input_ids, mask_id, label, metadata, folder_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        gen.id, gen.prompt, null, gen.enhance, gen.aspect_ratio, gen.count, gen.seed, gen.provider, gen.model,
        gen.input_ids, gen.mask_id, gen.label, gen.metadata, gen.folder_id, gen.created_at,
      );
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        // Without an explicit seed, spread variants randomly; with one, make them reproducible.
        const seed = dto.seed !== undefined ? baseSeed + i : randomInt(0, 2_000_000_000);
        this.db.run(
          `INSERT INTO jobs (id, generation_id, idx, status, seed, folder_id, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
          id, gen.id, i, seed, gen.folder_id, now,
        );
        jobIds.push(id);
      }
    });

    this.queue.enqueue(jobIds);
    this.events.generationChanged(gen.id);
    if (gen.folder_id) this.events.foldersChanged();
    return this.get(gen.id);
  }

  update(id: string, dto: UpdateGenerationDto): GenerationDto {
    this.get(id);
    if (dto.folderId !== undefined) {
      // Moving a whole generation moves all of its images.
      const jobIds = this.db.all<{ id: string }>('SELECT id FROM jobs WHERE generation_id = ?', id).map((j) => j.id);
      this.moveImages(jobIds, dto.folderId);
    }
    if (dto.label !== undefined) {
      this.db.run('UPDATE generations SET label = ? WHERE id = ?', dto.label?.trim() || null, id);
      this.events.generationChanged(id);
    }
    return this.get(id);
  }

  /** Move images (jobs) into a folder; null removes them from any folder. */
  moveImages(jobIds: string[], folderId: string | null) {
    if (folderId) this.assertFolder(folderId);
    const generationIds = new Set<string>();
    this.db.transaction(() => {
      for (const id of jobIds) {
        const job = this.db.get<{ generation_id: string }>('SELECT generation_id FROM jobs WHERE id = ?', id);
        if (!job) continue;
        this.db.run('UPDATE jobs SET folder_id = ? WHERE id = ?', folderId, id);
        generationIds.add(job.generation_id);
      }
    });
    for (const id of generationIds) this.events.generationChanged(id);
    this.events.foldersChanged();
    return { moved: jobIds.length, folderId };
  }

  private assertFolder(folderId: string) {
    if (!this.db.get('SELECT id FROM folders WHERE id = ?', folderId)) {
      throw new BadRequestException(`Unknown folder id: ${folderId}`);
    }
  }

  private filters(query: Pick<ListGenerationsQuery, 'q' | 'label' | 'folderId'>) {
    const where: string[] = [];
    const params: any[] = [];
    if (query.q) {
      where.push(`(prompt LIKE ? OR enhanced_prompt LIKE ? OR label LIKE ?)`);
      const like = `%${query.q}%`;
      params.push(like, like, like);
    }
    if (query.label) {
      where.push('label = ?');
      params.push(query.label);
    }
    // A generation is listed in a folder when at least one of its images is in it.
    if (query.folderId === 'none') {
      where.push('EXISTS (SELECT 1 FROM jobs j WHERE j.generation_id = generations.id AND j.folder_id IS NULL)');
    } else if (query.folderId) {
      where.push('EXISTS (SELECT 1 FROM jobs j WHERE j.generation_id = generations.id AND j.folder_id = ?)');
      params.push(query.folderId);
    }
    return { where, params };
  }

  list(query: ListGenerationsQuery) {
    const limit = query.limit ?? 20;
    const { where, params } = this.filters(query);
    if (query.cursor) {
      const [ts, id] = Buffer.from(query.cursor, 'base64url').toString().split(':');
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(Number(ts), Number(ts), id);
    }
    const rows = this.db.all<GenerationRow>(
      `SELECT * FROM generations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: this.toDtos(page),
      nextCursor: rows.length > limit && last ? Buffer.from(`${last.created_at}:${last.id}`).toString('base64url') : null,
    };
  }

  find(id: string): GenerationDto | null {
    const row = this.db.get<GenerationRow>('SELECT * FROM generations WHERE id = ?', id);
    return row ? this.toDtos([row])[0] : null;
  }

  get(id: string): GenerationDto {
    const dto = this.find(id);
    if (!dto) throw new NotFoundException(`Generation ${id} not found`);
    return dto;
  }

  /** Resolves when every job is finished, or after `timeoutMs` with the current state. */
  async waitFor(id: string, timeoutMs: number): Promise<GenerationDto> {
    const done = (g: GenerationDto) => g.progress.queued + g.progress.running === 0;
    const current = this.get(id);
    if (done(current)) return current;
    return firstValueFrom(
      race(
        this.events.stream.pipe(
          filter((e) => e.generationId === id),
          map(() => this.get(id)),
          filter(done),
        ),
        timer(timeoutMs).pipe(map(() => this.get(id))),
      ),
    );
  }

  cancel(id: string) {
    this.get(id);
    for (const job of this.db.all<JobRow>(`SELECT id FROM jobs WHERE generation_id = ? AND status IN ('queued', 'running')`, id)) {
      this.queue.cancel(job.id);
    }
    return this.get(id);
  }

  async remove(id: string) {
    const gen = this.db.get<GenerationRow>('SELECT * FROM generations WHERE id = ?', id);
    if (!gen) throw new NotFoundException(`Generation ${id} not found`);
    const jobs = this.db.all<JobRow>('SELECT * FROM jobs WHERE generation_id = ?', id);
    for (const job of jobs) this.queue.cancel(job.id);
    this.db.run('DELETE FROM jobs WHERE generation_id = ?', id);
    this.db.run('DELETE FROM generations WHERE id = ?', id);
    // Generated images belong to the generation; uploads may be reused so they stay.
    await this.assets.remove(jobs.map((j) => j.asset_id).filter((a): a is string => !!a));
    this.events.generationDeleted(id);
    if (jobs.some((j) => j.folder_id)) this.events.foldersChanged();
  }

  /** Delete a single generated image (the job is removed from its generation). */
  async removeJob(jobId: string) {
    const job = this.getJob(jobId);
    this.queue.cancel(jobId);
    this.db.run('DELETE FROM jobs WHERE id = ?', jobId);
    if (job.asset_id) await this.assets.remove([job.asset_id]);
    if (job.folder_id) this.events.foldersChanged();
    const left = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE generation_id = ?', job.generation_id)!.n;
    if (left === 0) {
      this.db.run('DELETE FROM generations WHERE id = ?', job.generation_id);
      this.events.generationDeleted(job.generation_id);
    } else {
      this.events.generationChanged(job.generation_id);
    }
  }

  getJob(jobId: string): JobRow {
    const job = this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }

  retryJob(jobId: string) {
    const job = this.getJob(jobId);
    if (!this.queue.retry(jobId)) throw new BadRequestException('Only failed or canceled jobs can be retried');
    return this.get(job.generation_id);
  }

  cancelJob(jobId: string) {
    const job = this.getJob(jobId);
    this.queue.cancel(jobId);
    return this.get(job.generation_id);
  }

  /** Re-queue every failed/canceled job of a generation. */
  retry(id: string) {
    this.get(id);
    for (const job of this.db.all<JobRow>(`SELECT id FROM jobs WHERE generation_id = ? AND status IN ('failed', 'canceled')`, id)) {
      this.queue.retry(job.id);
    }
    return this.get(id);
  }

  toDtos(rows: GenerationRow[]): GenerationDto[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const jobs = this.db.all<JobRow>(
      `SELECT * FROM jobs WHERE generation_id IN (${ids.map(() => '?').join(',')}) ORDER BY idx`,
      ...ids,
    );
    const assetIds = new Set<string>();
    for (const r of rows) {
      for (const id of JSON.parse(r.input_ids) as string[]) assetIds.add(id);
      if (r.mask_id) assetIds.add(r.mask_id);
    }
    for (const j of jobs) if (j.asset_id) assetIds.add(j.asset_id);
    const assets = this.assets.findMany([...assetIds]);
    const asset = (id: string | null) => {
      const row = id ? assets.get(id) : undefined;
      return row ? this.assets.toDto(row) : null;
    };
    const positions = this.queue.positions();

    return rows.map((r) => {
      const genJobs = jobs.filter((j) => j.generation_id === r.id);
      const progress: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
      for (const j of genJobs) progress[j.status]++;
      const status: GenerationStatus = progress.running
        ? 'running'
        : progress.queued
          ? 'queued'
          : progress.succeeded
            ? 'completed'
            : progress.failed
              ? 'failed'
              : 'canceled';
      const inputImages = (JSON.parse(r.input_ids) as string[]).map(asset).filter((a): a is AssetDto => !!a);
      return {
        id: r.id,
        prompt: r.prompt,
        enhancedPrompt: r.enhanced_prompt,
        enhance: !!r.enhance,
        aspectRatio: r.aspect_ratio,
        count: r.count,
        seed: r.seed,
        provider: r.provider,
        model: r.model,
        mode: r.mask_id ? 'inpaint' : inputImages.length ? 'image-to-image' : 'text-to-image',
        inputImages,
        mask: asset(r.mask_id),
        label: r.label,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        folderId: r.folder_id,
        status,
        progress,
        jobs: genJobs.map((j) => ({
          id: j.id,
          index: j.idx,
          status: j.status,
          seed: j.seed,
          queuePosition: positions.get(j.id) ?? null,
          error: j.error,
          attempts: j.attempts,
          image: asset(j.asset_id),
          folderId: j.folder_id,
          createdAt: new Date(j.created_at).toISOString(),
          startedAt: iso(j.started_at),
          finishedAt: iso(j.finished_at),
        })),
        createdAt: new Date(r.created_at).toISOString(),
      };
    });
  }
}
