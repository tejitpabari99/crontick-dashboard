import { describe, expect, it } from 'vitest';
import { delimiter } from 'node:path';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveNotifyMode,
  detectNotifySend,
} from '../../src/integrations/notify/gate.js';

type In = Parameters<typeof resolveNotifyMode>[0];
const base: In = { platform: 'linux', env: {}, notifySendOnPath: true, configValue: 'auto' };

describe('resolveNotifyMode', () => {
  const rows: Array<[string, Partial<In>, boolean, string | undefined, boolean]> = [
    ['linux no display -> off headless, no warning', {}, false, 'headless', false],
    ['linux DISPLAY + notify-send -> on', { env: { DISPLAY: ':0' } }, true, undefined, false],
    ['linux WAYLAND + notify-send -> on', { env: { WAYLAND_DISPLAY: 'wayland-0' } }, true, undefined, false],
    ['linux display no notify-send -> off + warning', { env: { DISPLAY: ':0' }, notifySendOnPath: false }, false, 'notify-send', true],
    ['linux empty DISPLAY counts as none', { env: { DISPLAY: '' } }, false, 'headless', false],
    ['darwin -> on', { platform: 'darwin' }, true, undefined, false],
    ['darwin + SSH -> on', { platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' } }, true, undefined, false],
    ['win32 -> on', { platform: 'win32' }, true, undefined, false],
    ['win32 + SSH -> on', { platform: 'win32', env: { SSH_CONNECTION: 'x' } }, true, undefined, false],
    ['freebsd -> off with reason', { platform: 'freebsd' }, false, 'freebsd', false],
    ['off override on desktop', { platform: 'darwin', configValue: 'off' }, false, 'config', false],
    ['on override on headless linux', { configValue: 'on' }, true, 'config', false],
    ['on override on unsupported platform', { platform: 'freebsd', configValue: 'on' }, true, 'config', false],
  ];
  it.each(rows)('%s', (_n, over, enabled, reasonHas, warn) => {
    const r = resolveNotifyMode({ ...base, ...over });
    expect(r.enabled).toBe(enabled);
    expect(r.mode).toBe(enabled ? 'on' : 'off');
    if (reasonHas) expect(r.reason).toContain(reasonHas);
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.warning !== undefined).toBe(warn);
  });
});

describe('detectNotifySend', () => {
  it('finds executable on PATH, no shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns-'));
    const f = join(dir, 'notify-send');
    writeFileSync(f, '#!/bin/sh\n');
    chmodSync(f, 0o755);
    expect(detectNotifySend({ PATH: ['/nonexistent', dir].join(delimiter) }, 'linux')).toBe(true);
    expect(detectNotifySend({ PATH: '/nonexistent' }, 'linux')).toBe(false);
    expect(detectNotifySend({}, 'linux')).toBe(false);
  });
});
