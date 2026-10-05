/** config.json loading: per-field fallback to defaults with warnings; mtime-based reload. */
import { statSync, readFileSync } from 'node:fs';
import { parseDuration } from './contract/formats.js';
import { configPath } from './paths.js';

export const DEFAULT_PORT = 47616;

export interface DashboardConfig {
  port: number;
  retentionDefault: string;
  nowPriorityThreshold: number;
  pollIntervalMs: number;
  timezone: string;
  notifications: { os: 'auto' | 'on' | 'off' };
}

export interface LoadedConfig {
  config: DashboardConfig;
  warnings: string[];
}

const systemTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function defaultConfig(): DashboardConfig {
  return {
    port: DEFAULT_PORT,
    retentionDefault: '7d',
    nowPriorityThreshold: 3,
    pollIntervalMs: 30000,
    timezone: systemTimezone(),
    notifications: { os: 'auto' },
  };
}

function validTimezone(v: unknown): v is string {
  if (typeof v !== 'string' || v === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}
function validDuration(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    parseDuration(v);
    return true;
  } catch {
    return false;
  }
}
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function parseConfig(raw: unknown): LoadedConfig {
  const config = defaultConfig();
  const warnings: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config, warnings: ['config.json is not a JSON object; using defaults'] };
  }
  const r = raw as Record<string, unknown>;
  const bad = (name: string, fallback: unknown) =>
    warnings.push(`config.json: invalid ${name}; using ${JSON.stringify(fallback)}`);

  if (r['port'] !== undefined) {
    if (isInt(r['port'], 1, 65535)) config.port = r['port'];
    else bad('port', config.port);
  }
  if (r['retentionDefault'] !== undefined) {
    if (validDuration(r['retentionDefault'])) config.retentionDefault = r['retentionDefault'];
    else bad('retentionDefault', config.retentionDefault);
  }
  if (r['nowPriorityThreshold'] !== undefined) {
    if (isInt(r['nowPriorityThreshold'], 0, 5)) config.nowPriorityThreshold = r['nowPriorityThreshold'];
    else bad('nowPriorityThreshold', config.nowPriorityThreshold);
  }
  if (r['pollIntervalMs'] !== undefined) {
    if (isInt(r['pollIntervalMs'], 1, 86_400_000)) config.pollIntervalMs = r['pollIntervalMs'];
    else bad('pollIntervalMs', config.pollIntervalMs);
  }
  if (r['timezone'] !== undefined) {
    if (validTimezone(r['timezone'])) config.timezone = r['timezone'];
    else bad('timezone', config.timezone);
  }
  if (r['notifications'] !== undefined) {
    const n = r['notifications'];
    const os = typeof n === 'object' && n !== null && !Array.isArray(n) ? (n as Record<string, unknown>)['os'] : undefined;
    if (typeof n !== 'object' || n === null || Array.isArray(n)) bad('notifications', config.notifications);
    else if (os !== undefined) {
      if (os === 'auto' || os === 'on' || os === 'off') config.notifications.os = os;
      else bad('notifications.os', config.notifications.os);
    }
  }
  return { config, warnings };
}

/** Reads config.json once. Missing file => defaults, no warning. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(configPath(env), 'utf8');
  } catch {
    return { config: defaultConfig(), warnings: [] };
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch {
    return { config: defaultConfig(), warnings: ['config.json is not valid JSON; using defaults'] };
  }
}

/** Port precedence: CRONTICK_DASHBOARD_PORT env > config.port > DEFAULT_PORT. Invalid env is ignored. */
export function resolvePort(config: DashboardConfig, env: NodeJS.ProcessEnv = process.env): number {
  const e = env['CRONTICK_DASHBOARD_PORT'];
  if (e !== undefined && /^\d+$/.test(e)) {
    const n = Number(e);
    if (n >= 1 && n <= 65535) return n;
  }
  return config.port;
}

export interface ConfigReader {
  get(): LoadedConfig;
}

/** Caches the parsed config; re-reads when config.json mtime changes (or file appears/disappears). */
export function createConfigReader(env: NodeJS.ProcessEnv = process.env): ConfigReader {
  let cached: LoadedConfig | undefined;
  let lastMtime: number | null | undefined;
  return {
    get() {
      let mtime: number | null;
      try {
        mtime = statSync(configPath(env)).mtimeMs;
      } catch {
        mtime = null;
      }
      if (cached === undefined || mtime !== lastMtime) {
        cached = loadConfig(env);
        lastMtime = mtime;
      }
      return cached;
    },
  };
}
