import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createNodeNotifierAdapter,
  isSafeOpenUrl,
  openUrlArgs,
} from '../../src/integrations/notify/node-notifier-adapter.js';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';

const URL_OK = 'http://127.0.0.1:7777/#card=abc';

type Cb = (err: Error | null, response?: string) => void;

function setup(platform: NodeJS.Platform = 'linux') {
  const emitter = new EventEmitter();
  let cb: Cb | undefined;
  const notify = vi.fn((_opts: unknown, c?: Cb) => {
    cb = c;
    return emitter;
  });
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const spawn = vi.fn((...args: unknown[]) => (args.length >= 0 ? child : child));
  const adapter = createNodeNotifierAdapter({
    notifier: { notify } as never,
    spawn: spawn as never,
    platform,
    deliveryGraceMs: 20,
  });
  return { adapter, notify, spawn, emitter, child, cb: () => cb };
}

describe('node-notifier adapter', () => {
  it('passes title/message/AUMID/wait to notifier', async () => {
    const s = setup();
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.cb()?.(null, 'ok');
    await p;
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.notify.mock.calls[0]?.[0]).toMatchObject({
      title: 'T',
      message: 'B',
      appID: 'Crontick.Dashboard',
      wait: true,
    });
  });

  it('resolves promptly without waiting for click (grace timer)', async () => {
    const s = setup();
    await expect(
      s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK }),
    ).resolves.toBeUndefined();
  });

  it('converts callback error to rejection', async () => {
    const s = setup();
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.cb()?.(new Error('no daemon'));
    await expect(p).rejects.toThrow('no daemon');
  });

  it('rejects when notifier throws synchronously', async () => {
    const adapter = createNodeNotifierAdapter({
      notifier: {
        notify: () => {
          throw new Error('boom');
        },
      } as never,
      spawn: vi.fn() as never,
    });
    await expect(adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK })).rejects.toThrow('boom');
  });

  it('opens url on click event (linux xdg-open, shell false, detached, unref)', async () => {
    const s = setup('linux');
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.emitter.emit('click');
    await p;
    expect(s.spawn).toHaveBeenCalledWith(
      'xdg-open',
      [URL_OK],
      expect.objectContaining({ shell: false, detached: true, stdio: 'ignore' }),
    );
    expect(s.child.unref).toHaveBeenCalled();
  });

  it('opens url on activate callback response, only once', async () => {
    const s = setup('darwin');
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.emitter.emit('click');
    s.cb()?.(null, 'activate');
    await p;
    expect(s.spawn).toHaveBeenCalledTimes(1);
    expect(s.spawn.mock.calls[0]?.[0]).toBe('open');
  });

  it('windows uses cmd /c start "" url', async () => {
    const s = setup('win32');
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.emitter.emit('click');
    await p;
    expect(s.spawn.mock.calls[0]?.slice(0, 2)).toEqual(['cmd', ['/c', 'start', '', URL_OK]]);
  });

  it('does not open an unsafe url on click', async () => {
    const s = setup();
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: 'http://evil.com/' });
    s.emitter.emit('click');
    await p;
    expect(s.spawn).not.toHaveBeenCalled();
  });

  it('spawn error event does not throw', async () => {
    const s = setup();
    const p = s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    s.emitter.emit('click');
    expect(() => s.child.emit('error', new Error('ENOENT'))).not.toThrow();
    await p;
  });

  it('late callback error after resolve is swallowed', async () => {
    const s = setup();
    await s.adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    expect(() => s.cb()?.(new Error('late'))).not.toThrow();
  });
});

describe('url validation', () => {
  it.each([
    [URL_OK, true],
    ['http://localhost:80/#card=x', true],
    ['https://127.0.0.1/', false],
    ['http://127.0.0.1.evil.com/', false],
    ['http://evil.com/', false],
    ['javascript:alert(1)', false],
    ['http://127.0.0.1:1/&calc', false],
    ['http://127.0.0.1:1/ x', false],
    ['not a url', false],
  ])('%s -> %s', (u, ok) => {
    expect(isSafeOpenUrl(u)).toBe(ok);
  });

  it('openUrlArgs per platform', () => {
    expect(openUrlArgs('darwin', URL_OK)).toEqual(['open', [URL_OK]]);
    expect(openUrlArgs('linux', URL_OK)).toEqual(['xdg-open', [URL_OK]]);
    expect(openUrlArgs('win32', URL_OK)).toEqual(['cmd', ['/c', 'start', '', URL_OK]]);
  });
});

describe('FakeNotifyAdapter', () => {
  it('records calls', async () => {
    const f = new FakeNotifyAdapter();
    await f.notify({ title: 'a', body: 'b', openUrl: 'u' });
    expect(f.calls).toEqual([{ title: 'a', body: 'b', openUrl: 'u' }]);
  });
  it('can reject and throw', async () => {
    const f = new FakeNotifyAdapter();
    f.failWith = { mode: 'reject', error: new Error('r') };
    await expect(f.notify({ title: 'a', body: 'b', openUrl: 'u' })).rejects.toThrow('r');
    f.failWith = { mode: 'throw', error: new Error('t') };
    expect(() => f.notify({ title: 'a', body: 'b', openUrl: 'u' })).toThrow('t');
    expect(f.calls).toHaveLength(2);
  });
});

describe('node-notifier adapter injected timers', () => {
  it('settles when the injected grace timer fires and clears it on early settle', async () => {
    const fns: Array<() => void> = [];
    const cleared: unknown[] = [];
    const timers = {
      setTimeout: (fn: () => void) => (fns.push(fn), fns.length),
      clearTimeout: (h: unknown) => void cleared.push(h),
    };
    const notify = vi.fn(() => new EventEmitter());
    const adapter = createNodeNotifierAdapter({ notifier: { notify } as never, platform: 'linux', timers, deliveryGraceMs: 1_000_000 });
    const p = adapter.notify({ title: 'T', body: 'B', openUrl: URL_OK });
    expect(fns).toHaveLength(1);
    fns[0]!();
    await expect(p).resolves.toBeUndefined();
    expect(cleared).toEqual([1]);
  });
});
