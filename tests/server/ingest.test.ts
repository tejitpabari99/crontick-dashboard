import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedIngest, type CardChange } from '../../src/feed/ingest.js';
import { createFeedWatcher } from '../../src/feed/watcher.js';
import { FEED_SETTLE_DELAYS_MS } from '../../src/constants/feed.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feed-'));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const view = (extra: object = {}) => JSON.stringify({ type: 'markdown', title: 'T', ...extra });
const data = (updatedAt?: string, text = 'hi', extra: object = {}) =>
  JSON.stringify({ ...(updatedAt ? { updatedAt } : {}), data: { text }, ...extra });
const put = (path: string, text: string, mtimeSec?: number) => {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
  if (mtimeSec !== undefined) utimesSync(full, mtimeSec, mtimeSec);
};
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function setup() {
  const changes: CardChange[] = [];
  const ing = createFeedIngest({ feedDir: dir, onChange: (c) => changes.push(c) });
  return { ing, changes };
}

describe('card-folder ingest', () => {
  it('AC1: card.json then data.json -> one card, one new change', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    ing.processFolder('x');
    expect(ing.store.get('x')).toMatchObject({ status: 'no-data' });
    expect(changes.map((c) => c.type)).toEqual(['new']); // the no-data entry
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    expect(ing.store.list()).toHaveLength(1);
    expect(ing.store.get('x')).toMatchObject({ status: 'ok', file: 'x/data.json', dataVersion: '2026-01-01T00:00:00Z' });
  });

  it('AC1: data.json before card.json is held, then arrives as a single new with data', () => {
    const { ing, changes } = setup();
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    expect(ing.store.list()).toHaveLength(0);
    expect(changes).toHaveLength(0);
    put('x/card.json', view());
    ing.processFolder('x');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'new', key: 'x', contentChanged: true });
    expect(changes[0]?.entry).toMatchObject({ status: 'ok', dataHash: sha(data('2026-01-01T00:00:00Z')) });
  });

  it('AC1: card.json-only edit -> changed with contentChanged:false, hashes tracked', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.rescan();
    const first = ing.store.get('x');
    changes.length = 0;
    put('x/card.json', view({ title: 'Renamed' }));
    ing.processFolder('x');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'changed', key: 'x', contentChanged: false });
    const e = ing.store.get('x');
    expect(e).toMatchObject({ status: 'ok', card: { title: 'Renamed' } });
    expect(e?.status === 'ok' && first?.status === 'ok' && e.viewHash !== first.viewHash && e.dataHash === first.dataHash).toBe(true);
  });

  it('AC2: new updatedAt or new mtime -> contentChanged; same bytes rewritten -> nothing', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'), 1000);
    ing.rescan();
    changes.length = 0;
    put('x/data.json', data('2026-01-01T00:00:00Z'), 2000); // identical bytes, new mtime, explicit updatedAt
    ing.processFolder('x');
    expect(changes).toHaveLength(0);
    put('x/data.json', data('2026-02-01T00:00:00Z'), 3000);
    ing.processFolder('x');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'changed', contentChanged: true });
    // no explicit updatedAt: effective version is the mtime
    put('x/data.json', data(undefined), 4000);
    ing.processFolder('x');
    changes.length = 0;
    put('x/data.json', data(undefined), 5000); // same bytes, new mtime
    ing.processFolder('x');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ contentChanged: true });
    expect(ing.store.get('x')).toMatchObject({ dataVersion: new Date(5000 * 1000).toISOString() });
  });

  it('AC3: card.json only -> no-data entry carrying viewMtimeMs', () => {
    const { ing } = setup();
    put('x/card.json', view({ staleAfter: '1h' }), 1234);
    ing.processFolder('x');
    const e = ing.store.get('x');
    expect(e).toMatchObject({ status: 'no-data', viewMtimeMs: 1234 * 1000, key: 'x' });
  });

  it('entry carries dataPath (resolved) and honors card.json data name', () => {
    const { ing } = setup();
    put('x/card.json', view({ data: 'out.json' }));
    put('x/out.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    expect(ing.store.get('x')).toMatchObject({ status: 'ok', file: 'x/out.json', dataPath: join(dir, 'x', 'out.json') });
  });

  it('AC5: folder delete -> removed; rename -> old removed, new id new', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.rescan();
    changes.length = 0;
    renameSync(join(dir, 'x'), join(dir, 'y'));
    ing.rescan();
    expect(changes.map((c) => `${c.type}:${c.key}`).sort()).toEqual(['new:y', 'removed:x']);
    expect(ing.store.list().map((e) => e.key)).toEqual(['y']);
    rmSync(join(dir, 'y'), { recursive: true });
    ing.processFolder('y');
    expect(ing.store.list()).toHaveLength(0);
    expect(changes.at(-1)).toMatchObject({ type: 'removed', key: 'y' });
  });

  it('AC5: loose file -> one stable warning, cleared when removed', () => {
    const { ing } = setup();
    put('old.json', '{}');
    ing.rescan();
    ing.rescan();
    expect(ing.issues()).toEqual(['feed/old.json ignored: panels are folders (feed/<id>/card.json)']);
    expect(ing.store.list()).toHaveLength(0);
    unlinkSync(join(dir, 'old.json'));
    ing.rescan();
    expect(ing.issues()).toEqual([]);
  });

  it('AC5: folder without card.json warns only after 3 s, clears when card.json appears', () => {
    const { ing } = setup();
    mkdirSync(join(dir, 'x'));
    ing.processFolder('x');
    vi.advanceTimersByTime(2999);
    expect(ing.issues()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ing.issues()).toEqual(['feed/x ignored: card.json is missing']);
    put('x/card.json', view());
    ing.processFolder('x');
    expect(ing.issues()).toEqual([]);
    expect(ing.store.get('x')).toMatchObject({ status: 'no-data' });
  });

  it('mkdir then write is silent (card.json lands inside the window)', () => {
    const { ing } = setup();
    mkdirSync(join(dir, 'x'));
    ing.processFolder('x');
    vi.advanceTimersByTime(1000);
    put('x/card.json', view());
    ing.processFolder('x');
    vi.advanceTimersByTime(10_000);
    expect(ing.issues()).toEqual([]);
  });

  it('card.json invalid -> skipped + warning feed:<id>; fixed -> cleared', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    put('x/card.json', JSON.stringify({ type: 'nope-not-a-type-but-valid-shape', title: 5 }));
    ing.processFolder('x');
    expect(ing.store.get('x')).toBeUndefined();
    expect(changes.at(-1)).toMatchObject({ type: 'removed', key: 'x' });
    expect(ing.issues()).toHaveLength(1);
    expect(ing.issues()[0]).toMatch(/^feed\/x skipped: /);
    put('x/card.json', view());
    ing.processFolder('x');
    expect(ing.issues()).toEqual([]);
    expect(ing.store.get('x')).toMatchObject({ status: 'ok' });
  });

  it('malformed card.json settles (keeps previous entry), then is skipped with a warning', () => {
    const { ing, changes } = setup();
    put('x/card.json', view(), 1000);
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    changes.length = 0;
    put('x/card.json', '{"type":', 2000);
    ing.processFolder('x');
    expect(ing.store.get('x')).toMatchObject({ status: 'ok' });
    expect(ing.issues()).toEqual([]);
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[2]! + 10);
    expect(ing.store.get('x')).toBeUndefined();
    expect(ing.issues()[0]).toMatch(/^feed\/x skipped: .*invalid JSON/);
  });

  it('half-written card.json that completes inside the window never shows a warning', () => {
    const { ing, changes } = setup();
    put('x/card.json', '{"type":', 1000);
    ing.processFolder('x');
    vi.advanceTimersByTime(100);
    put('x/card.json', view(), 2000);
    ing.processFolder('x');
    vi.advanceTimersByTime(10_000);
    expect(ing.issues()).toEqual([]);
    expect(changes.map((c) => c.type)).toEqual(['new']);
  });

  it('malformed data.json settles 250ms/1s/3s keeping previous entry, restarts on mtime change, then Broken', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    changes.length = 0;
    put('x/data.json', '{"data":', 1000);
    ing.processFolder('x');
    expect(ing.store.get('x')).toMatchObject({ status: 'ok' });
    vi.advanceTimersByTime(250); // first re-read: unchanged -> keep waiting
    expect(ing.store.get('x')).toMatchObject({ status: 'ok' });
    put('x/data.json', '{"data":{', 2000); // still being written
    vi.advanceTimersByTime(750); // re-read at 1 s sees the new mtime: schedule restarts
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[2]! - 1);
    expect(ing.store.get('x')).toMatchObject({ status: 'ok' });
    vi.advanceTimersByTime(1);
    expect(ing.store.get('x')).toMatchObject({ status: 'broken', reason: 'malformed-json' });
    expect(changes.at(-1)).toMatchObject({ type: 'changed', contentChanged: true });
  });

  it('half-written data.json that completes keeps one changed (no broken flash)', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    changes.length = 0;
    put('x/data.json', '{"data":', 1000);
    ing.processFolder('x');
    vi.advanceTimersByTime(300);
    put('x/data.json', data('2026-02-01T00:00:00Z'), 2000);
    ing.processFolder('x');
    vi.advanceTimersByTime(10_000);
    expect(changes.map((c) => c.type)).toEqual(['changed']);
    expect(ing.store.get('x')).toMatchObject({ status: 'ok', dataVersion: '2026-02-01T00:00:00Z' });
  });

  it('schema-invalid data is Broken immediately (no settling)', () => {
    const { ing } = setup();
    put('x/card.json', view());
    put('x/data.json', JSON.stringify({ data: { text: 5 } }));
    ing.processFolder('x');
    expect(ing.store.get('x')).toMatchObject({ status: 'broken', reason: 'schema-invalid', id: 'x' });
  });

  it('ignores dot-prefixed and .tmp entries; dot-prefixed folders and alerts are never cards', () => {
    const { ing } = setup();
    put('x/card.json', view());
    put('x/.data.json.abc.tmp', 'garbage');
    put('x/data.json.tmp', 'garbage');
    put('x/.hidden', 'garbage');
    put('.hiddenfolder/card.json', view());
    put('alerts/card.json', view());
    put('.DS_Store', 'x');
    put('foo.tmp', 'x');
    ing.rescan();
    expect(ing.store.list().map((e) => e.key)).toEqual(['x']);
    expect(ing.store.get('x')).toMatchObject({ status: 'no-data' });
    expect(ing.issues()).toEqual([]);
  });

  it('data path escaping the folder via symlink is skipped', () => {
    const { ing } = setup();
    put('outside.json', data());
    put('x/card.json', view({ data: 'link.json' }));
    try {
      symlinkSync(join(dir, 'outside.json'), join(dir, 'x', 'link.json'));
    } catch {
      return; // no symlink permission (Windows CI)
    }
    ing.processFolder('x');
    expect(ing.store.get('x')).toBeUndefined();
    expect(ing.issues()[0]).toMatch(/^feed\/x skipped: .*outside the card folder/);
  });

  it('selfWrite flag keyed <id>/data.json is consumed on matching ingest', () => {
    const { ing, changes } = setup();
    put('x/card.json', view());
    put('x/data.json', data('2026-01-01T00:00:00Z'));
    ing.processFolder('x');
    expect(changes.at(-1)?.selfWrite).toBeFalsy();
    const wrong = data('2026-03-01T00:00:00Z');
    put('x/data.json', wrong);
    ing.selfWrites.set('x/data.json', 'wrong-hash');
    ing.processFolder('x');
    expect(changes.at(-1)?.selfWrite).toBeFalsy();
    const own = data('2026-05-01T00:00:00Z', 'mine');
    ing.selfWrites.set('x/data.json', sha(own));
    put('x/data.json', own, 5000);
    ing.processFolder('x');
    expect(changes.at(-1)?.selfWrite).toBe(true);
    expect(ing.selfWrites.has('x/data.json')).toBe(false);
  });
});

describe('feed watcher wiring', () => {
  it('start scans existing folders, rescan picks up a new subfolder and file', () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    put('a/card.json', view());
    put('a/data.json', data('2026-01-01T00:00:00Z'));
    const w = createFeedWatcher({ feedDir: dir });
    w.start();
    expect(w.store.get('a')).toBeDefined();
    put('b/card.json', view()); // may or may not produce an event; rescan must cover it
    put('b/data.json', data('2026-01-01T00:00:00Z'));
    vi.advanceTimersByTime(10_000);
    expect(w.store.get('b')).toMatchObject({ status: 'ok' });
    w.stop();
  });
});
