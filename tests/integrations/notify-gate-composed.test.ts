import { describe, expect, it, vi } from 'vitest';
import { createNotifyGate, resolveNotifyGate } from '../../src/integrations/notify/gate.js';
import type { NotifyOsSetting } from '../../src/integrations/notify/gate.js';

const display = { DISPLAY: ':0' };

describe('createNotifyGate', () => {
  it('probes only on linux + auto + display', () => {
    const cases: Array<[NodeJS.Platform, NotifyOsSetting, Record<string, string>, boolean]> = [
      ['linux', 'auto', display, true],
      ['linux', 'auto', { WAYLAND_DISPLAY: 'w0' }, true],
      ['linux', 'auto', {}, false],
      ['linux', 'on', display, false],
      ['linux', 'off', display, false],
      ['darwin', 'auto', display, false],
      ['win32', 'auto', display, false],
    ];
    for (const [platform, configValue, env, probes] of cases) {
      const detect = vi.fn(() => true);
      createNotifyGate({ getConfigValue: () => configValue, env, platform, detect })();
      expect(detect.mock.calls.length, `${platform}/${configValue}/${JSON.stringify(env)}`).toBe(probes ? 1 : 0);
    }
  });

  it('caches the probe across calls', () => {
    const detect = vi.fn(() => true);
    const gate = createNotifyGate({ getConfigValue: () => 'auto', env: display, platform: 'linux', detect });
    expect(gate().mode).toBe('on');
    gate();
    gate();
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('caches a negative probe too', () => {
    const detect = vi.fn(() => false);
    const gate = createNotifyGate({ getConfigValue: () => 'auto', env: display, platform: 'linux', detect });
    expect(gate().mode).toBe('off');
    expect(gate().reason).toMatch(/notify-send/);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('re-resolves when config changes', () => {
    let cfg: NotifyOsSetting = 'auto';
    const detect = vi.fn(() => true);
    const gate = createNotifyGate({ getConfigValue: () => cfg, env: display, platform: 'linux', detect });
    expect(gate().mode).toBe('on');
    cfg = 'off';
    expect(gate().mode).toBe('off');
    cfg = 'on';
    expect(gate().mode).toBe('on');
    cfg = 'auto';
    expect(gate().mode).toBe('on');
    expect(detect).toHaveBeenCalledTimes(1);
  });
});

describe('resolveNotifyGate', () => {
  it('one-shot resolves with injected detect', () => {
    const detect = vi.fn(() => false);
    const r = resolveNotifyGate({ configValue: 'auto', env: display, platform: 'linux', detect });
    expect(r).toMatchObject({ enabled: false, mode: 'off' });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('headless linux does not probe', () => {
    const detect = vi.fn(() => true);
    const r = resolveNotifyGate({ configValue: 'auto', env: {}, platform: 'linux', detect });
    expect(r.reason).toMatch(/headless/);
    expect(detect).not.toHaveBeenCalled();
  });
});
