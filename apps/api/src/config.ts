import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (apps/api/{src,dist} -> ../../..). */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

// Load the single root-level .env so the user only has one file to edit.
// It overrides inherited variables: shell helpers (e.g. the zsh dotenv plugin)
// export stale copies of it. Set IMAGEGEN_IGNORE_DOTENV=1 to skip (tests).
if (!process.env.IMAGEGEN_IGNORE_DOTENV) {
  for (const file of [path.join(REPO_ROOT, '.env'), path.join(REPO_ROOT, 'apps/api/.env')]) {
    if (existsSync(file)) dotenv.config({ path: file, quiet: true, override: true });
  }
}

const str = (name: string, fallback = '') => (process.env[name] ?? '').trim() || fallback;
const int = (name: string, fallback: number) => {
  const n = Number.parseInt(str(name), 10);
  return Number.isFinite(n) ? n : fallback;
};

const port = int('API_PORT', 4310);

export const config = {
  port,
  /** Public base URL of this API, used to build absolute image URLs. */
  publicUrl: str('API_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  /** Comma separated list of allowed browser origins ("*" = any). */
  corsOrigins: str('CORS_ORIGINS', '*'),
  /** Optional bearer token protecting the API (leave empty for local use). */
  apiToken: str('API_TOKEN'),
  dataDir: path.resolve(REPO_ROOT, str('DATA_DIR', 'data')),

  queue: {
    // One local GPU: jobs run one at a time (the inference server serializes anyway).
    concurrency: Math.max(1, int('QUEUE_CONCURRENCY', 1)),
    maxAttempts: Math.max(1, int('QUEUE_MAX_ATTEMPTS', 3)),
  },

  image: {
    /** Which ImageProvider implementation to use: local | mock */
    provider: str('IMAGE_PROVIDER', 'local'),
    model: str('IMAGE_MODEL', 'black-forest-labs/FLUX.2-klein-4B'),
  },

  text: {
    /**
     * Prompt enhancer LLM: local (FLUX.2 klein's own Qwen3 text encoder, served by
     * the inference server) | openai-compatible (Ollama, LM Studio...) | mock
     */
    provider: str('TEXT_PROVIDER', 'local'),
    /** Only used by openai-compatible. */
    model: str('TEXT_MODEL', 'qwen3-vl:8b'),
    baseUrl: str('TEXT_BASE_URL', 'http://localhost:11434/v1').replace(/\/$/, ''),
    apiKey: str('TEXT_API_KEY'),
  },

  /** Python diffusers server (apps/inference). */
  inference: {
    url: str('INFERENCE_URL', `http://127.0.0.1:${int('INFERENCE_PORT', 8000)}`).replace(/\/$/, ''),
  },
};

export type AppConfig = typeof config;
