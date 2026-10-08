import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { DEFAULT_PORT } from '../src/constants/http.ts';
import { ENV_PORT } from '../src/constants/env.ts';
import { portFilePath } from '../src/paths.ts';

/** Daemon port for the dev /api proxy: env override, then daemon.port file, then default. */
export function resolveDaemonPort(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env[ENV_PORT]);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const fromFile = Number(readFileSync(portFilePath(env), 'utf8').trim());
    if (Number.isInteger(fromFile) && fromFile > 0) return fromFile;
  } catch {
    /* no port file: daemon not running */
  }
  return DEFAULT_PORT;
}

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': `http://127.0.0.1:${resolveDaemonPort()}` },
  },
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
