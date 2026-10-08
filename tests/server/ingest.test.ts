import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedIngest, type CardChange } from '../../src/feed/ingest.js';
import { createFeedWatcher } from '../../src/feed/watcher.js';
import { MAX_CARD_BYTES } from '../../src/constants/contract.js';
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

const card = (id: string, updatedAt = '2026-01-01T00:00:00Z', extra: object = {}) =>
  JSON.stringify({ id, kind: 'panel', type: 'markdown', title: id, updatedAt, data: { text: 'hi' }, ...extra });
const put = (name: string, text: string, mtimeSec?: number) => {
  writeFileSync(join(dir, name), text);
  if (mtimeSec !== undefined) utimesSync(join(dir, name), mtimeSec, mtimeSec);
};

/** Two files differing only by extension case (a.json / a.JSON) cannot coexist on case-insensitive filesystems (macOS, Windows). */
function isCaseInsensitiveFs(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'case-'));
  try {
    writeFileSync(join(probe, 'x.json'), '1');
    writeFileSync(join(probe, 'x.JSON'), '2');
    return readdirSync(probe).length === 1;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const itCaseSensitive = isCaseInsensitiveFs() ? it.skip : it;

function setup() {
  const changes: CardChange[] = [];
  const ing = createFeedIngest({ feedDir: dir, onChange: (c) => changes.push(c) });
  return { ing, changes };
}

describe('feed ingest', () => {
  it('ingests valid cards, ignores non-json, dotfiles, tmp, subdirs', () => {
    const { ing } = setup();
    put('a.json', card('a'));
    put('notes.txt', 'x');
    put('.b.json', card('b'));
    put('c.json.tmp', card('c'));
    put('d.tmp', card('d'));
    mkdirSync(join(dir, 'sub.json'));
    ing.rescan();
    expect(ing.store.list().map((e) => e.key)).toEqual(['a']);
    expect(ing.store.get('a')).toMatchObject({ status: 'ok', file: 'a.json' });
  });

  it('same-id rewrite updates in place; delete removes', () => {
    const { ing, changes } = setup();
    put('a.json', card('a'));
    ing.rescan();
    put('a.json', card('a', '2026-01-02T00:00:00Z'));
    ing.processFile('a.json');
    const e = ing.store.get('a');
    expect(e?.status === 'ok' && e.card.updatedAt).toBe('2026-01-02T00:00:00Z');
    expect(ing.store.list()).toHaveLength(1);
    unlinkSync(join(dir, 'a.json'));
    ing.rescan();
    expect(ing.store.list()).toHaveLength(0);
    expect(changes.map((c) => c.type)).toEqual(['new', 'changed', 'removed']);
    expect(changes[1]?.prev?.key).toBe('a');
  });

  it('truncated file completed within 1 s never yields Broken', () => {
    const { ing } = setup();
    const full = card('a');
    put('a.json', full.slice(0, 20));
    ing.processFile('a.json');
    expect(ing.store.get('a')).toBeUndefined();
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[0]); // retry 1, still truncated
    expect(ing.store.list()).toHaveLength(0);
    vi.advanceTimersByTime(500);
    put('a.json', full, Date.now() / 1000 + 10);
    vi.advanceTimersByTime(300); // retry 2 at 1 s sees complete file
    expect(ing.store.get('a')).toMatchObject({ status: 'ok' });
  });

  it('truncated file stays Broken(malformed) after 3 s; previous card kept while settling', () => {
    const { ing } = setup();
    put('a.json', card('a'), 1000);
    ing.processFile('a.json');
    put('a.json', '{"id":"a","ki', 2000);
    ing.processFile('a.json');
    vi.advanceTimersByTime(2900);
    expect(ing.store.get('a')).toMatchObject({ status: 'ok' }); // previous kept
    vi.advanceTimersByTime(200);
    expect(ing.store.get('a')).toBeUndefined(); // malformed carries no id -> file key
    expect(ing.store.get('file:a.json')).toMatchObject({ status: 'broken', reason: 'malformed-json', file: 'a.json' });
    // no id parseable on a fresh truncated file -> file key
    put('z.json', '{"id', 3000);
    ing.processFile('z.json');
    vi.advanceTimersByTime(3100);
    expect(ing.store.get('file:z.json')).toMatchObject({ status: 'broken', reason: 'malformed-json', title: 'z.json' });
  });

  it('mtime still changing extends settling', () => {
    const { ing } = setup();
    put('a.json', '{"id', 1000);
    ing.processFile('a.json');
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[0]);
    put('a.json', '{"id":', 2000);
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[0]);
    put('a.json', '{"id":"a"', 3000);
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[2] - 2 * FEED_SETTLE_DELAYS_MS[0]);
    expect(ing.store.list()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(ing.store.get('file:a.json')?.status).toBe('broken');
  });

  it('other broken reasons are immediate', () => {
    const { ing } = setup();
    put('a.json', JSON.stringify({ id: 'a', kind: 'panel', type: 'markdown' }));
    ing.processFile('a.json');
    expect(ing.store.get('a')).toMatchObject({ status: 'broken', reason: 'schema-invalid' });
  });

  it('id-mismatch keys by file and never shadows the valid card', () => {
    const { ing } = setup();
    put('a.json', card('a'));
    put('b.json', card('a', '2027-01-01T00:00:00Z'));
    ing.rescan();
    expect(ing.store.get('a')).toMatchObject({ status: 'ok', file: 'a.json' });
    expect(ing.store.get('file:b.json')).toMatchObject({ status: 'broken', reason: 'id-mismatch', id: 'a', title: 'a' });
  });

  it('oversized file is Broken too-large without reading', () => {
    const { ing } = setup();
    put('big.json', 'x'.repeat(MAX_CARD_BYTES + 1));
    ing.processFile('big.json');
    expect(ing.store.get('file:big.json')).toMatchObject({ status: 'broken', reason: 'too-large' });
  });

  itCaseSensitive('id collision: newest updatedAt wins; loser is duplicate-id', () => {
    const { ing } = setup();
    put('a.json', card('a', '2026-01-01T00:00:00Z'));
    put('a.JSON', card('a', '2026-02-01T00:00:00Z'));
    ing.rescan();
    expect(ing.store.get('a')).toMatchObject({ status: 'ok', file: 'a.JSON' });
    expect(ing.store.get('file:a.json')).toMatchObject({
      status: 'broken',
      reason: 'duplicate-id',
      message: 'duplicate id `a` also in `a.JSON`',
    });
  });

  itCaseSensitive('id collision tie breaks on newest mtime', () => {
    const { ing } = setup();
    put('a.json', card('a'), 1000);
    put('a.JSON', card('a'), 2000);
    ing.rescan();
    expect(ing.store.get('a')).toMatchObject({ file: 'a.JSON' });
  });

  it('selfWrite flag on changes consumes selfWrites', () => {
    const { ing, changes } = setup();
    put('a.json', card('a'));
    ing.processFile('a.json');
    expect(changes.at(-1)?.selfWrite).toBeFalsy();
    const text = card('a', '2026-03-01T00:00:00Z');
    put('a.json', text);
    ing.selfWrites.set('a.json', 'wrong-hash'); // wrong hash -> not self write
    ing.processFile('a.json');
    expect(changes.at(-1)?.selfWrite).toBeFalsy();
    const t2 = card('a', '2026-04-01T00:00:00Z');
    put('a.json', t2);
    ing.selfWrites.set('a.json', ing.store.get('a')!.hash);
    ing.processFile('a.json');
    expect(changes.at(-1)?.selfWrite).toBeFalsy();
    const own = card('a', '2026-05-01T00:00:00Z', { priority: 4 });
    ing.selfWrites.set('a.json', createHash('sha256').update(Buffer.from(own)).digest('hex'));
    put('a.json', own, 5000);
    ing.processFile('a.json');
    expect(changes.at(-1)?.selfWrite).toBe(true);
    expect(ing.selfWrites.has('a.json')).toBe(false);
  });
});

describe('feed watcher wiring', () => {
  it('start scans existing files, debounces events, rescan catches missed ones', () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    put('a.json', card('a'));
    const w = createFeedWatcher({ feedDir: dir });
    w.start();
    expect(w.store.get('a')).toBeDefined();
    put('b.json', card('b')); // may or may not produce an event; rescan must cover it
    vi.advanceTimersByTime(10_000);
    expect(w.store.get('b')).toBeDefined();
    w.stop();
  });
});
