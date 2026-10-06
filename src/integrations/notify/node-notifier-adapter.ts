import { spawn as nodeSpawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import nodeNotifier from 'node-notifier';
import { LOOPBACK_HOST } from '../../constants/http.js';
import { NOTIFY_AUMID, NOTIFY_DELIVERY_GRACE_MS } from '../../constants/notify.js';
import { realTimers, type TimeoutTimers } from '../../utils/timers.js';
import type { NotifyAdapter, NotifyPayload } from './adapter.js';

const UNSAFE_CHARS = /[\s&|^<>%"'`]/;

type NotifyCallback = (err: Error | null, response?: unknown) => void;
export interface NotifierLike {
  notify(opts: Record<string, unknown>, cb?: NotifyCallback): EventEmitter | unknown;
}
type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: 'ignore'; detached: true; shell: false },
) => { unref(): void; on(ev: 'error', fn: (e: Error) => void): unknown };

export interface NodeNotifierOptions {
  notifier?: NotifierLike;
  spawn?: SpawnLike;
  platform?: NodeJS.Platform;
  /** Time to wait for an error callback before treating the toast as delivered. */
  deliveryGraceMs?: number;
  /** Timer source for the delivery grace period (default real timers). */
  timers?: TimeoutTimers;
}

/** Only server-built loopback http URLs may be opened; also rejects shell metacharacters. */
export function isSafeOpenUrl(raw: string): boolean {
  if (UNSAFE_CHARS.test(raw)) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'http:' && (u.hostname === LOOPBACK_HOST || u.hostname === 'localhost');
}

export function openUrlArgs(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

export function createNodeNotifierAdapter(opts: NodeNotifierOptions = {}): NotifyAdapter {
  const notifier = opts.notifier ?? (nodeNotifier as unknown as NotifierLike);
  const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const platform = opts.platform ?? process.platform;
  const timers = opts.timers ?? realTimers;
  const graceMs = opts.deliveryGraceMs ?? NOTIFY_DELIVERY_GRACE_MS;

  function open(url: string): void {
    if (!isSafeOpenUrl(url)) return;
    try {
      const [cmd, args] = openUrlArgs(platform, url);
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
      child.on('error', () => {});
      child.unref();
    } catch {
      // best effort
    }
  }

  return {
    notify({ title, body, openUrl }: NotifyPayload): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let opened = false;
        let timer: unknown;
        const settle = (err?: Error): void => {
          if (settled) return; // late errors/events are ignored
          settled = true;
          if (timer !== undefined) timers.clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        const onClick = (): void => {
          if (opened) return;
          opened = true;
          open(openUrl);
        };
        try {
          // wait:true enables click reporting on win32/mac, but keeps the callback open
          // until click/timeout there; so resolve after a grace period instead.
          const emitter = notifier.notify(
            { title, message: body, appID: NOTIFY_AUMID, wait: true },
            (err, response) => {
              if (err) return settle(err);
              if (response === 'activate' || response === 'clicked') onClick();
              settle();
            },
          ) as EventEmitter | undefined;
          emitter?.on?.('click', onClick);
          emitter?.on?.('activate', onClick);
          timer = timers.setTimeout(() => settle(), graceMs);
        } catch (e) {
          settle(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
  };
}
