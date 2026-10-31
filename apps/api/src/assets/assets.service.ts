import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class AssetsService {
  private readonly dir = path.join(config.dataDir, 'images');
  private readonly thumbDir = path.join(config.dataDir, 'thumbs');

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

  async remove(ids: string[]) {
    const rows = this.findMany(ids);
    for (const row of rows.values()) {
      this.db.run('DELETE FROM assets WHERE id = ?', row.id);
      await rm(this.filePath(row), { force: true });
      await rm(path.join(this.thumbDir, `${row.id}.webp`), { force: true });
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
