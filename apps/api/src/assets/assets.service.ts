import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { config } from '../config.js';
import { type AssetRow, DatabaseService } from '../db/database.service.js';
import type { InputImage } from '../providers/types.js';

export interface AssetDto {
  id: string;
  kind: AssetRow['kind'];
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

const MAX_INPUT_SIDE = 2048;
const THUMB_WIDTH = 640;
export interface UploadDto extends AssetDto {
  /** Number of generations using this upload as an input image. */
  usedBy: number;
}

/**
 * Unreferenced generated images and masks younger than this are kept: a generated
 * image is saved just before its job row points to it, and a mask just before its
 * generation. Uploads are never removed automatically (see the Uploads page).
 */
const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/** SQL condition: asset `a` is used by an image or as a generation's input/mask. */
const REFERENCED = `(
  EXISTS (SELECT 1 FROM jobs j WHERE j.asset_id = a.id)
  OR EXISTS (
    SELECT 1 FROM generations g
    WHERE g.mask_id = a.id OR EXISTS (SELECT 1 FROM json_each(g.input_ids) WHERE json_each.value = a.id)
  )
)`;

@Injectable()
export class AssetsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AssetsService.name);
  private readonly dir = path.join(config.dataDir, 'images');
  private readonly thumbDir = path.join(config.dataDir, 'thumbs');
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DatabaseService) {
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.thumbDir, { recursive: true });
  }

  /** Store an image buffer. Uploads are normalized (EXIF rotation, max size). */
  async save(buffer: Buffer, kind: AssetRow['kind']): Promise<AssetRow> {
    let img = sharp(buffer, { failOn: 'none' });
    let meta: Metadata;
    try {
      meta = await img.metadata();
    } catch {
      throw new BadRequestException('Unsupported or corrupted image file');
    }
    if (!meta.format) throw new BadRequestException('Unsupported image format');

    let data = buffer;
    let mime = `image/${String(meta.format) === 'jpg' ? 'jpeg' : meta.format}`;
    if (kind !== 'generated') {
      img = img.rotate().resize(MAX_INPUT_SIDE, MAX_INPUT_SIDE, { fit: 'inside', withoutEnlargement: true });
      if (kind === 'mask') {
        data = await img.removeAlpha().grayscale().png().toBuffer();
        mime = 'image/png';
      } else if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.pages && meta.pages > 1) {
        data = await img.png().toBuffer();
        mime = 'image/png';
      } else {
        data = await img.toBuffer();
      }
    }
    const final = await sharp(data).metadata();
    const ext = mime.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const row: AssetRow = {
      id: randomUUID(),
      kind,
      file: '',
      mime,
      width: final.width ?? 0,
      height: final.height ?? 0,
      bytes: data.length,
      created_at: Date.now(),
    };
    row.file = `${row.id}.${ext}`;
    await writeFile(path.join(this.dir, row.file), data);
    this.db.run(
      'INSERT INTO assets (id, kind, file, mime, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.id, row.kind, row.file, row.mime, row.width, row.height, row.bytes, row.created_at,
    );
    return row;
  }

  /** Accepts data URLs, raw base64 or http(s) URLs (handy for API automation). */
  async saveFromString(input: string, kind: AssetRow['kind'] = 'upload'): Promise<AssetRow> {
    if (/^https?:\/\//i.test(input)) {
      const res = await fetch(input).catch(() => null);
      if (!res?.ok) throw new BadRequestException(`Could not download image from ${input}`);
      return this.save(Buffer.from(await res.arrayBuffer()), kind);
    }
    const base64 = input.replace(/^data:[^;]+;base64,/, '');
    return this.save(Buffer.from(base64, 'base64'), kind);
  }

  find(id: string): AssetRow | undefined {
    return this.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', id);
  }

  findMany(ids: string[]): Map<string, AssetRow> {
    if (!ids.length) return new Map();
    const rows = this.db.all<AssetRow>(`SELECT * FROM assets WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    return new Map(rows.map((r) => [r.id, r]));
  }

  get(id: string): AssetRow {
    const row = this.find(id);
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    return row;
  }

  filePath(row: AssetRow) {
    return path.join(this.dir, row.file);
  }

  async readInput(id: string): Promise<InputImage> {
    const row = this.get(id);
    return { data: await readFile(this.filePath(row)), mime: row.mime, width: row.width, height: row.height };
  }

  /** Lazily generated, cached WebP thumbnail. */
  async thumbnailPath(row: AssetRow): Promise<string> {
    const file = path.join(this.thumbDir, `${row.id}.webp`);
    const exists = await stat(file).then(() => true, () => false);
    if (!exists) {
      const data = await sharp(this.filePath(row))
        .resize(THUMB_WIDTH, undefined, { withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(file, data);
    }
    return file;
  }

  onApplicationBootstrap() {
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Uploaded images, newest first (cursor pagination). */
  listUploads(cursor?: string, limit = 60) {
    const params: unknown[] = [];
    let where = `a.kind = 'upload'`;
    if (cursor) {
      const [ts, id] = Buffer.from(cursor, 'base64url').toString().split(':');
      where += ' AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))';
      params.push(Number(ts), Number(ts), id);
    }
    const rows = this.db.all<AssetRow & { used_by: number }>(
      `SELECT a.*, (SELECT COUNT(*) FROM generations g, json_each(g.input_ids) WHERE json_each.value = a.id) AS used_by
       FROM assets a WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM assets WHERE kind = 'upload'`)!.n;
    return {
      items: page.map((r): UploadDto => ({ ...this.toDto(r), usedBy: r.used_by })),
      total,
      nextCursor: rows.length > limit && last ? Buffer.from(`${last.created_at}:${last.id}`).toString('base64url') : null,
    };
  }

  /**
   * Deletes uploads (rows, files, thumbnails), even when generations used them
   * as references: those generations simply no longer show that input.
   */
  async deleteUploads(ids: string[]) {
    const uploads = [...this.findMany([...new Set(ids)]).values()].filter((r) => r.kind === 'upload').map((r) => r.id);
    await this.remove(uploads);
    this.db.flush();
    return uploads;
  }

  isReferenced(id: string): boolean {
    return !!this.db.get(`SELECT 1 FROM assets a WHERE a.id = ? AND ${REFERENCED}`, id);
  }

  /** Deletes the given assets (rows, files, thumbnails) unless something still uses them. */
  async removeUnused(ids: string[]) {
    const unused = [...new Set(ids)].filter((id) => !this.isReferenced(id));
    await this.remove(unused);
    return unused.length;
  }

  private async remove(ids: string[]) {
    const rows = this.findMany(ids);
    for (const row of rows.values()) {
      this.db.run('DELETE FROM assets WHERE id = ?', row.id);
      await rm(this.filePath(row), { force: true });
      await rm(path.join(this.thumbDir, `${row.id}.webp`), { force: true });
    }
  }

  /**
   * Garbage-collects what nothing uses anymore: masks and images orphaned by
   * interrupted jobs, and stray files without a database row. Uploads are kept.
   */
  async sweep(graceMs = ORPHAN_GRACE_MS) {
    try {
      const cutoff = Date.now() - graceMs;
      const orphans = this.db
        .all<{ id: string }>(`SELECT a.id FROM assets a WHERE a.kind != 'upload' AND a.created_at < ? AND NOT ${REFERENCED}`, cutoff)
        .map((r) => r.id);
      await this.remove(orphans);

      const known = new Set(this.db.all<{ id: string }>('SELECT id FROM assets').map((r) => r.id));
      let strays = 0;
      for (const dir of [this.dir, this.thumbDir]) {
        for (const file of await readdir(dir)) {
          const id = file.replace(/\.[^.]+$/, '');
          if (known.has(id)) continue;
          const full = path.join(dir, file);
          // A file is written just before its row is inserted: leave fresh ones alone.
          const { mtimeMs } = await stat(full).catch(() => ({ mtimeMs: Date.now() }));
          if (mtimeMs >= cutoff) continue;
          await rm(full, { force: true });
          strays++;
        }
      }
      if (orphans.length || strays) {
        this.db.flush();
        this.logger.log(`Cleaned up ${orphans.length} orphaned image(s)/mask(s) and ${strays} stray file(s)`);
      }
    } catch (err) {
      this.logger.warn(`Asset cleanup failed: ${(err as Error).message}`);
    }
  }

  toDto(row: AssetRow): AssetDto {
    const base = `${config.publicUrl}/api/assets/${row.id}`;
    return {
      id: row.id,
      kind: row.kind,
      url: `${base}/file`,
      thumbUrl: `${base}/thumb`,
      downloadUrl: `${base}/file?download=1`,
      mime: row.mime,
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
