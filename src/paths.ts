/**
 * Data directory path resolution. Precedence: the ENV_HOME env var >
 * platform default via env-paths (suffix '').
 */
import envPaths from 'env-paths';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from './constants/app.js';
import { ENV_HOME } from './constants/env.js';

type Env = NodeJS.ProcessEnv;

export function dataDir(env: Env = process.env): string {
  const override = env[ENV_HOME];
  if (override) return override;
  return envPaths(APP_NAME, { suffix: '' }).data;
}
export const feedDir = (env: Env = process.env): string => join(dataDir(env), 'feed');
export const doneDir = (env: Env = process.env): string => join(dataDir(env), 'feed', 'alerts', '.done');
export const alertsDir = (env: Env = process.env): string => join(dataDir(env), 'feed', 'alerts');
export const statePath = (env: Env = process.env): string => join(dataDir(env), 'state.json');
export const configPath = (env: Env = process.env): string => join(dataDir(env), 'config.json');
export const pidFilePath = (env: Env = process.env): string => join(dataDir(env), 'daemon.pid');
export const portFilePath = (env: Env = process.env): string => join(dataDir(env), 'daemon.port');
export const logFilePath = (env: Env = process.env): string => join(dataDir(env), 'daemon.log');
export const lockFilePath = (env: Env = process.env): string => join(dataDir(env), 'daemon.lock');

// Owner-only (rwx------); mode is ignored on Windows.
const PRIVATE_DIR_MODE = 0o700;

/** First-run setup: creates dirs and a default config.json. Never creates state.json. */
export function ensureDirs(env: Env = process.env): void {
  for (const dir of [dataDir(env), feedDir(env), alertsDir(env)]) {
    mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  const cfg = configPath(env);
  if (!existsSync(cfg)) writeFileSync(cfg, '{}\n', { flag: 'wx', mode: 0o600 });
}
