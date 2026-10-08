import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedWatcher, mapFeedEvent, type WatchFn } from '../../src/feed/watcher.js';

describe('mapFeedEvent', () => {
  it.each([
    ['cpu/card.json', { kind: 'folder', name: 'cpu' }],
    ['cpu\\data.json', { kind: 'folder', name: 'cpu' }],
    ['cpu', { kind: 'folder', name: 'cpu' }],
    ['loose.json', { kind: 'folder', name: 'loose.json' }],
    ['alerts/a.json', { kind: 'alert', name: 'a.json' }],
    ['alerts\\a.json', { kind: 'alert', name: 'a.json' }],
    ['alerts/.done/a.json', { kind: 'done', name: 'a.json' }],
    ['alerts\\.done\\a.json', { kind: 'done', name: 'a.json' }],
    ['cpu/.data.json.swp', null],
    ['cpu/data.json.tmp', null],
    ['cpu/data.TMP', null],
    ['alerts/.a.json', null],
    ['alerts/a.json.tmp', null],
    ['alerts/.done/a.json.tmp', null],
    ['alerts', null],
    ['alerts/.done', null],
    ['', null],
  ])('%j', (name, want) => {
    expect(mapFeedEvent(name)).toEqual(want);
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces all files of a folder into one processFolder call; null filename rescans', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wd-'));
    try {
      let emit: (ev: string, f: string | null) => void = () => {};
      const watchFn: WatchFn = (_d, _o, l) => {
        emit = l;
        return { close() {}, on() { return this as never; } };
      };
      const w = createFeedWatcher({ feedDir: dir, watchFn, rescanMs: 1_000_000 });
      w.start();
      mkdirSync(join(dir, 'a'));
      writeFileSync(join(dir, 'a', 'card.json'), JSON.stringify({ title: 'A', type: 'markdown' }));
      writeFileSync(join(dir, 'a', 'data.json'), JSON.stringify({ data: { text: 'x' } }));
      emit('change', 'a/card.json');
      vi.advanceTimersByTime(150);
      emit('change', 'a/data.json');
      emit('change', 'a/.data.json.tmp');
      vi.advanceTimersByTime(150);
      expect(w.store.get('a')).toBeUndefined(); // 150 ms after last real event: still pending
      vi.advanceTimersByTime(60);
      expect(w.store.get('a')).toBeDefined(); // one flush after 200 ms of quiet
      w.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AC12 real fs', () => {
  it('picks up a new subfolder created after start', { timeout: 15_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac12-'));
    const w = createFeedWatcher({ feedDir: dir, rescanMs: 300 });
    try {
      w.start();
      const d = join(dir, 'fresh');
      mkdirSync(d);
      writeFileSync(join(d, 'card.json'), JSON.stringify({ title: 'Fresh', type: 'markdown' }));
      writeFileSync(join(d, 'data.json'), JSON.stringify({ data: { text: 'hi' } }));
      await vi.waitFor(() => expect(w.store.get('fresh')?.status).toBe('ok'), { timeout: 10_000, interval: 50 });
    } finally {
      w.stop();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
