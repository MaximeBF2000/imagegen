import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { config } from '../config.js';
import { DatabaseService, type JobRow } from '../db/database.service.js';
import { ProviderError } from '../providers/types.js';
import { EventsService } from './events.service.js';
import { GenerationRunner } from './generation-runner.service.js';

/**
 * Persistent FIFO job queue with bounded concurrency.
 * State lives in SQLite, so queued work survives restarts; the in-memory list
 * only holds the processing order.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private pending: string[] = [];
  private readonly running = new Map<string, AbortController>();
  private stopped = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly runner: GenerationRunner,
    private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    // Jobs interrupted by a restart go back to the queue.
    this.db.run(`UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`);
    this.pending = this.db
      .all<{ id: string }>(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, idx`)
      .map((r) => r.id);
    if (this.pending.length) this.logger.log(`Resuming ${this.pending.length} queued job(s)`);
    this.tick();
  }

  onApplicationShutdown() {
    this.stopped = true;
    for (const ctrl of this.running.values()) ctrl.abort(new Error('shutdown'));
  }

  enqueue(jobIds: string[]) {
    this.pending.push(...jobIds);
    this.tick();
  }

  /** Cancels a queued or running job. Returns false if it already finished. */
  cancel(jobId: string): boolean {
    const job = this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return false;
    this.pending = this.pending.filter((id) => id !== jobId);
    this.running.get(jobId)?.abort(new Error('canceled'));
    this.db.run(`UPDATE jobs SET status = 'canceled', finished_at = ? WHERE id = ?`, Date.now(), jobId);
    this.events.generationChanged(job.generation_id);
    return true;
  }

  /** Puts a failed/canceled job back in the queue with a fresh attempt counter. */
  retry(jobId: string): boolean {
    const job = this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
    if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return false;
    this.db.run(
      `UPDATE jobs SET status = 'queued', error = NULL, attempts = 0, started_at = NULL, finished_at = NULL WHERE id = ?`,
      jobId,
    );
    this.events.generationChanged(job.generation_id);
    this.enqueue([jobId]);
    return true;
  }

  /** 1-based position of each waiting job. */
  positions(): Map<string, number> {
    return new Map(this.pending.map((id, i) => [id, i + 1]));
  }

  stats() {
    return { queued: this.pending.length, running: this.running.size, concurrency: config.queue.concurrency };
  }

  private tick() {
    while (!this.stopped && this.running.size < config.queue.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      void this.process(id);
    }
  }

  private async process(jobId: string) {
    const job = this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
    if (!job || job.status !== 'queued') return this.tick();

    const ctrl = new AbortController();
    this.running.set(jobId, ctrl);
    const attempts = job.attempts + 1;
    this.db.run(`UPDATE jobs SET status = 'running', started_at = ?, attempts = ? WHERE id = ?`, Date.now(), attempts, jobId);
    this.events.generationChanged(job.generation_id);

    try {
      const { assetId, meta } = await this.runner.run({ ...job, attempts }, ctrl.signal);
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      this.db.run(
        `UPDATE jobs SET status = 'succeeded', asset_id = ?, meta = ?, error = NULL, finished_at = ? WHERE id = ? AND status = 'running'`,
        assetId,
        meta ? JSON.stringify(meta) : null,
        Date.now(),
        jobId,
      );
    } catch (err) {
      const current = this.db.get<JobRow>('SELECT status FROM jobs WHERE id = ?', jobId);
      if (ctrl.signal.aborted || !current || current.status !== 'running') {
        // Canceled by the user, deleted, or shutting down: nothing to record
        // (shutdown leaves it 'running', which bootstrap re-queues).
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = !(err instanceof ProviderError) || err.retryable;
        if (retryable && attempts < config.queue.maxAttempts) {
          const delay = 1500 * 2 ** (attempts - 1);
          this.logger.warn(`Job ${jobId} failed (attempt ${attempts}), retrying in ${delay}ms: ${message}`);
          this.db.run(`UPDATE jobs SET status = 'queued', error = ? WHERE id = ?`, message, jobId);
          setTimeout(() => {
            if (this.db.get<JobRow>('SELECT status FROM jobs WHERE id = ?', jobId)?.status === 'queued') {
              this.pending.unshift(jobId);
              this.tick();
            }
          }, delay);
        } else {
          this.logger.error(`Job ${jobId} failed: ${message}`);
          this.db.run(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`, message, Date.now(), jobId);
        }
      }
    } finally {
      this.running.delete(jobId);
      this.events.generationChanged(job.generation_id);
      this.tick();
    }
  }
}
