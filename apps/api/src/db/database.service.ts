import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../config.js';

export interface AssetRow {
  id: string;
  kind: 'upload' | 'generated' | 'mask';
  file: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  created_at: number;
}

export interface GenerationRow {
  id: string;
  prompt: string;
  enhanced_prompt: string | null;
  enhance: number;
  aspect_ratio: string;
  count: number;
  seed: number | null;
  provider: string;
  model: string;
  input_ids: string; // JSON string[]
  mask_id: string | null;
  label: string | null;
  metadata: string | null; // JSON
  folder_id: string | null;
  created_at: number;
}

export interface FolderRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobRow {
  id: string;
  generation_id: string;
  idx: number;
  status: JobStatus;
  seed: number;
  asset_id: string | null;
  error: string | null;
  attempts: number;
  meta: string | null;
  folder_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const MIGRATIONS = [
  `CREATE TABLE assets (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     file TEXT NOT NULL,
     mime TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE generations (
     id TEXT PRIMARY KEY,
     prompt TEXT NOT NULL,
     enhanced_prompt TEXT,
     enhance INTEGER NOT NULL DEFAULT 0,
     aspect_ratio TEXT NOT NULL,
     count INTEGER NOT NULL,
     seed INTEGER,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     input_ids TEXT NOT NULL DEFAULT '[]',
     mask_id TEXT,
     label TEXT,
     metadata TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX generations_created ON generations(created_at DESC);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY,
     generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
     idx INTEGER NOT NULL,
     status TEXT NOT NULL,
     seed INTEGER NOT NULL,
     asset_id TEXT,
     error TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     meta TEXT,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     finished_at INTEGER
   );
   CREATE INDEX jobs_generation ON jobs(generation_id);
   CREATE INDEX jobs_status ON jobs(status, created_at);`,
  `CREATE TABLE folders (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   -- Folder a generation was created into (default for its images)
   ALTER TABLE generations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
   -- Folder membership is per image
   ALTER TABLE jobs ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
   CREATE INDEX jobs_folder ON jobs(folder_id, generation_id);`,
];

/** Tiny SQLite layer on Node's built-in `node:sqlite` (no native addon to compile). */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor() {
    mkdirSync(config.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(config.dataDir, 'imagegen.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  all<T>(sql: string, ...params: any[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: any[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  onModuleDestroy() {
    this.db.close();
  }
}
