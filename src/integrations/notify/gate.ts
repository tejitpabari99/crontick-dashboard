import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type NotifyOsSetting = 'auto' | 'on' | 'off';

export interface NotifyGateInput {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  notifySendOnPath: boolean;
  configValue: NotifyOsSetting;
}

export interface NotifyGateResult {
  enabled: boolean;
  mode: 'on' | 'off';
  reason: string;
  warning?: string;
}

const set = (v: string | undefined): boolean => v !== undefined && v !== '';

/** Pure: decide whether OS notifications are enabled (PRD Decision 3). */
export function resolveNotifyMode(input: NotifyGateInput): NotifyGateResult {
  const { platform, env, notifySendOnPath, configValue } = input;
  const on = (reason: string): NotifyGateResult => ({ enabled: true, mode: 'on', reason });
  const off = (reason: string, warning?: string): NotifyGateResult =>
    warning === undefined
      ? { enabled: false, mode: 'off', reason }
      : { enabled: false, mode: 'off', reason, warning };

  if (configValue === 'off') return off('notifications.os is set to off in config');
  if (configValue === 'on') return on('notifications.os is set to on in config');

  if (platform === 'darwin' || platform === 'win32') {
    return on(`auto: ${platform === 'darwin' ? 'macOS' : 'Windows'} desktop`);
  }
  if (platform === 'linux') {
    if (!set(env['DISPLAY']) && !set(env['WAYLAND_DISPLAY'])) {
      return off('auto: headless (no DISPLAY or WAYLAND_DISPLAY)');
    }
    if (!notifySendOnPath) {
      const reason = 'auto: notify-send not found on PATH';
      return off(reason, `OS notifications off: ${reason}; install libnotify or set notifications.os to off`);
    }
    return on('auto: Linux desktop with notify-send');
  }
  return off(`auto: unsupported platform ${platform}`);
}

/** Impure: is `notify-send` an executable on PATH? No shell involved. */
export function detectNotifySend(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const path = env['PATH'] ?? env['Path'];
  if (!set(path)) return false;
  const names = platform === 'win32' ? ['notify-send.exe', 'notify-send.cmd', 'notify-send'] : ['notify-send'];
  for (const dir of (path as string).split(delimiter)) {
    if (dir === '') continue;
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (!statSync(p).isFile()) continue;
        accessSync(p, constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}
