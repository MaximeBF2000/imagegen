import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { type AssetDto, AssetsService } from '../assets/assets.service.js';
import { slugify, type ZipEntry } from '../common/zip.js';
import { type AssetRow, DatabaseService, type FolderRow } from '../db/database.service.js';
import { EventsService } from '../generations/events.service.js';
import { GenerationsService } from '../generations/generations.service.js';

export interface FolderDto {
  id: string;
  name: string;
  imageCount: number;
  /** Most recent images (up to 4), for folder previews. */
  covers: AssetDto[];
  createdAt: string;
  updatedAt: string;
}

/** Which images an archive / bulk operation targets. */
export type ImageScope = { folderId?: string; ids?: string[] };

@Injectable()
export class FoldersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly assets: AssetsService,
    private readonly generations: GenerationsService,
    private readonly events: EventsService,
  ) {}

  list() {
    const rows = this.db.all<FolderRow & { image_count: number }>(
      `SELECT f.*, (SELECT COUNT(*) FROM jobs j WHERE j.folder_id = f.id AND j.status = 'succeeded') AS image_count
       FROM folders f ORDER BY f.name COLLATE NOCASE`,
    );
    const count = (where: string) =>
      this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'succeeded' ${where}`)!.n;
    return {
      items: rows.map((r) => this.toDto(r, r.image_count)),
      allCount: count(''),
      unfiledCount: count('AND folder_id IS NULL'),
    };
  }

  get(id: string): FolderDto {
    const row = this.db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id);
    if (!row) throw new NotFoundException(`Folder ${id} not found`);
    const n = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE folder_id = ? AND status = 'succeeded'`, id)!.n;
    return this.toDto(row, n);
  }

  create(name: string): FolderDto {
    const now = Date.now();
    const id = randomUUID();
    this.db.run('INSERT INTO folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, name.trim(), now, now);
    this.events.foldersChanged();
    return this.get(id);
  }

  rename(id: string, name: string): FolderDto {
    this.get(id);
    this.db.run('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?', name.trim(), Date.now(), id);
    this.events.foldersChanged();
    return this.get(id);
  }

  /** Deletes a folder. Its images go back to "no folder" unless `deleteImages` is set. */
  async remove(id: string, deleteImages: boolean) {
    this.get(id);
    const jobs = this.db.all<{ id: string; generation_id: string }>('SELECT id, generation_id FROM jobs WHERE folder_id = ?', id);
    if (deleteImages) {
      for (const job of jobs) await this.generations.removeJob(job.id);
    }
    this.db.run('UPDATE jobs SET folder_id = NULL WHERE folder_id = ?', id);
    this.db.run('UPDATE generations SET folder_id = NULL WHERE folder_id = ?', id);
    this.db.run('DELETE FROM folders WHERE id = ?', id);
    if (!deleteImages) {
      for (const g of new Set(jobs.map((j) => j.generation_id))) this.events.generationChanged(g);
    }
    this.events.foldersChanged();
  }

  /** Zip entries (images + manifest) for a folder, "none" (unfiled), everything, or explicit image ids. */
  archive(scope: ImageScope): { name: string; entries: ZipEntry[] } {
    const where: string[] = [`j.status = 'succeeded'`, 'j.asset_id IS NOT NULL'];
    const params: string[] = [];
    let name = 'all-images';
    if (scope.ids?.length) {
      where.push(`j.id IN (${scope.ids.map(() => '?').join(',')})`);
      params.push(...scope.ids);
      name = `selection-${scope.ids.length}-images`;
    } else if (scope.folderId === 'none') {
      where.push('j.folder_id IS NULL');
      name = 'unfiled';
    } else if (scope.folderId) {
      where.push('j.folder_id = ?');
      params.push(scope.folderId);
      name = slugify(this.get(scope.folderId).name) || 'folder';
    }

    const rows = this.db.all<
      AssetRow & { job_id: string; idx: number; seed: number; prompt: string; enhanced_prompt: string | null; finished_at: number; model: string }
    >(
      `SELECT a.*, j.id AS job_id, j.idx, j.seed, j.finished_at, g.prompt, g.enhanced_prompt, g.model
       FROM jobs j JOIN generations g ON g.id = j.generation_id JOIN assets a ON a.id = j.asset_id
       WHERE ${where.join(' AND ')} ORDER BY j.finished_at, j.idx`,
      ...params,
    );

    const used = new Set<string>();
    const manifest: Record<string, unknown>[] = [];
    const entries: ZipEntry[] = rows.map((r) => {
      const ext = r.file.split('.').pop();
      const base = slugify(r.prompt) || 'image';
      let file = `${base}-${r.idx + 1}.${ext}`;
      for (let n = 2; used.has(file); n++) file = `${base}-${r.idx + 1}-${n}.${ext}`;
      used.add(file);
      manifest.push({
        file,
        prompt: r.prompt,
        enhancedPrompt: r.enhanced_prompt,
        seed: r.seed,
        model: r.model,
        width: r.width,
        height: r.height,
        createdAt: new Date(r.finished_at ?? r.created_at).toISOString(),
      });
      return { name: file, path: this.assets.filePath(r), mtime: new Date(r.finished_at ?? r.created_at) };
    });
    entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
    return { name, entries };
  }

  private toDto(row: FolderRow, imageCount: number): FolderDto {
    const covers = this.db.all<AssetRow>(
      `SELECT a.* FROM jobs j JOIN assets a ON a.id = j.asset_id
       WHERE j.folder_id = ? AND j.status = 'succeeded' ORDER BY j.finished_at DESC LIMIT 4`,
      row.id,
    );
    return {
      id: row.id,
      name: row.name,
      imageCount,
      covers: covers.map((a) => this.assets.toDto(a)),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
