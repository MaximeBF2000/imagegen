// Mirrors the API DTOs (apps/api/src/generations/generations.service.ts).

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
export type AspectRatio = '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16' | '21:9' | 'auto';

export interface Asset {
  id: string;
  kind: 'upload' | 'generated' | 'mask';
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

export interface Job {
  id: string;
  index: number;
  status: JobStatus;
  seed: number;
  queuePosition: number | null;
  error: string | null;
  attempts: number;
  image: Asset | null;
  folderId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Generation {
  id: string;
  prompt: string;
  enhancedPrompt: string | null;
  enhance: boolean;
  aspectRatio: AspectRatio;
  count: number;
  seed: number | null;
  provider: string;
  model: string;
  mode: 'text-to-image' | 'image-to-image' | 'inpaint';
  inputImages: Asset[];
  mask: Asset | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  /** Folder the generation was created into; each image has its own folderId. */
  folderId: string | null;
  status: GenerationStatus;
  progress: Record<JobStatus, number>;
  jobs: Job[];
  createdAt: string;
}

export interface GenerationPage {
  items: Generation[];
  nextCursor: string | null;
}

export interface QueueStats {
  queued: number;
  running: number;
  concurrency: number;
}

export interface AppConfig {
  ready: boolean;
  issues: string[];
  image: {
    provider: string;
    model: string;
    capabilities: { maxReferenceImages: number; nativeInpainting: boolean; aspectRatios: AspectRatio[]; seed: boolean };
  };
  text: { provider: string; model: string };
  queue: QueueStats;
  limits: { maxVariants: number; maxInputImages: number };
  authRequired: boolean;
}

export interface CreateGenerationInput {
  prompt: string;
  count?: number;
  aspectRatio?: AspectRatio;
  seed?: number;
  inputImageIds?: string[];
  maskId?: string;
  enhance?: boolean;
  label?: string;
  folderId?: string;
}

export interface Folder {
  id: string;
  name: string;
  imageCount: number;
  covers: Asset[];
  createdAt: string;
  updatedAt: string;
}

export interface FolderList {
  items: Folder[];
  allCount: number;
  unfiledCount: number;
}

/** Feed scope: every image, images without a folder, or a folder id. */
export type FolderScope = 'all' | 'none' | (string & {});

/** A generated image together with its context, used by the lightbox. */
export interface ImageEntry {
  job: Job;
  image: Asset;
  generation: Generation;
}
