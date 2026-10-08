/** config.json loading: per-field fallback to defaults with warnings; mtime-based reload. */
import { statSync, readFileSync } from 'node:fs';
import { DEFAULT_NOTIFY_OS, DEFAULT_NOW_PRIORITY_THRESHOLD, MAX_NOW_PRIORITY_THRESHOLD, MIN_NOW_PRIORITY_THRESHOLD } from './constants/config.js';
import { ENV_PORT } from './constants/env.js';
import { DEFAULT_PORT } from './constants/http.js';
import { POLL_DEFAULT_MS, POLL_MAX_MS, POLL_MIN_MS } from './constants/poll.js';
import { configPath } from './paths.js';
import { parsePort } from './utils/port.js';

export interface DashboardConfig {
  port: number;
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
    nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD,
    pollIntervalMs: POLL_DEFAULT_MS,
    timezone: systemTimezone(),
    notifications: { os: DEFAULT_NOTIFY_OS },
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
    const port = typeof r['port'] === 'number' ? parsePort(r['port']) : undefined;
    if (port !== undefined) config.port = port;
    else bad('port', config.port);
  }
  if (r['nowPriorityThreshold'] !== undefined) {
    if (isInt(r['nowPriorityThreshold'], MIN_NOW_PRIORITY_THRESHOLD, MAX_NOW_PRIORITY_THRESHOLD)) config.nowPriorityThreshold = r['nowPriorityThreshold'];
    else bad('nowPriorityThreshold', config.nowPriorityThreshold);
  }
  if (r['pollIntervalMs'] !== undefined) {
    if (isInt(r['pollIntervalMs'], POLL_MIN_MS, POLL_MAX_MS)) config.pollIntervalMs = r['pollIntervalMs'];
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

/** Port precedence: ENV_PORT env > config.port > DEFAULT_PORT. Invalid env is ignored. */
export function resolvePort(config: DashboardConfig, env: NodeJS.ProcessEnv = process.env): number {
  return parsePort(env[ENV_PORT]) ?? config.port;
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
