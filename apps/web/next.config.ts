import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Single .env at the repository root, shared with the API.
const rootEnv = path.resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_API_TOKEN: process.env.NEXT_PUBLIC_API_TOKEN || '',
  },
};

export default nextConfig;
