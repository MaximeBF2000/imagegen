import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import type { NextConfig } from 'next';

// Single .env at the repository root, shared with the API. It overrides
// inherited variables (shell helpers may export stale copies of it).
const rootEnv = path.resolve(__dirname, '../../.env');
if (existsSync(rootEnv) && !process.env.IMAGEGEN_IGNORE_DOTENV) {
  Object.assign(process.env, parseEnv(readFileSync(rootEnv, 'utf8')));
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4310',
    NEXT_PUBLIC_API_TOKEN: process.env.NEXT_PUBLIC_API_TOKEN || '',
  },
};

export default nextConfig;
