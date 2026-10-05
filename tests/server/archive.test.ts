import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createArchive, type Archive } from '../../src/feed/archive.js';
import { createFeedIngest } from '../../src/feed/ingest.js';
import { fakeClock, type FakeClock } from '../../src/clock.js';
import { MS_PER_DAY } from '../../src/constants/time.js';
import type { IntervalTimers } from '../../src/utils/timers.js';

const DAY = MS_PER_DAY;
let root: string;
let feed: string;
let arch: string;
let clock: FakeClock;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arch-'));
  feed = join(root, 'feed');
  arch = join(root, 'archive');
  mkdirSync(feed);
  clock = fakeClock('2026-03-01T00:00:00Z');
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const body = (id: string, updatedAt = '2026-01-01T00:00:00Z', extra: object = {}) => ({
  id, kind: 'panel', type: 'markdown', title: id, updatedAt, data: { text: 'hi' }, ...extra,
});
const put = (name: string, text: string) => writeFileSync(join(feed, name), text);
const versions = (id: string) => (existsSync(join(arch, id)) ? readdirSync(join(arch, id)).sort() : []);

function setup(retentionDefault = '7d') {
  let hourly: (() => void) | undefined;
  const timers: IntervalTimers = {
    setInterval: (fn) => {
      hourly = fn;
      return 1;
    },
    clearInterval: () => {
      hourly = undefined;
    },
  };
  const holder: { a?: Archive } = {};
  const ing = createFeedIngest({ feedDir: feed, onIngest: (i) => holder.a?.onIngest(i) });
  const a = createArchive({
    archiveDir: arch,
    clock,
    timers,
    retentionDefault: () => retentionDefault,
    cards: () => {
      const m = new Map<string, string | undefined>();
      for (const e of ing.store.list()) {
        if (e.status === 'ok') m.set(e.key, e.card['retention'] as string | undefined);
        else if (e.id !== undefined) m.set(e.id, undefined);
      }
      return m;
    },
  });
  holder.a = a;
  return { ing, a, tick: () => hourly?.() };
}

describe('archive', () => {
  it('writes a filename-safe version; byte-identical rewrite dedupes', () => {
    const { ing } = setup();
    put('a.json', JSON.stringify(body('a', '2026-01-01T10:00:00+02:00')));
    ing.processFile('a.json');
    const v = versions('a');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^[0-9A-Za-z.+-]+-[0-9a-f]{8}\.json$/);
    expect(v[0]).not.toContain(':');
    put('a.json', JSON.stringify(body('a', '2026-01-01T10:00:00+02:00')));
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(1);
  });

  it('whitespace-only and key-order rewrites dedupe; updatedAt-only change archives', () => {
    const { ing } = setup();
    put('a.json', JSON.stringify(body('a')));
    ing.processFile('a.json');
    clock.advance(1000);
    put('a.json', JSON.stringify(body('a'), null, 4) + '\n');
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(1);
    clock.advance(1000);
    put('a.json', JSON.stringify(body('a', '2026-01-02T00:00:00Z')));
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(2);
  });

  it('dedupe is restart-safe (newest hash from disk)', () => {
    const one = setup();
    put('a.json', JSON.stringify(body('a')));
    one.ing.processFile('a.json');
    const two = setup();
    two.ing.processFile('a.json');
    expect(versions('a')).toHaveLength(1);
  });

  it('does not archive self-writes', () => {
    const { ing } = setup();
    put('a.json', JSON.stringify(body('a')));
    ing.processFile('a.json');
    const edited = JSON.stringify({ ...body('a'), extra: 1 }, null, 2) + '\n';
    ing.selfWrites.set('a.json', createHash('sha256').update(edited).digest('hex'));
    put('a.json', edited);
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(1);
  });

  it('retention prunes old versions but keeps the newest', () => {
    const { ing } = setup();
    put('a.json', JSON.stringify(body('a', '2026-01-01T00:00:00Z', { retention: '2d' })));
    ing.processFile('a.json');
    clock.advance(DAY);
    put('a.json', JSON.stringify(body('a', '2026-01-02T00:00:00Z', { retention: '2d' })));
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(2);
    clock.advance(2 * DAY + 1000); // first is 3d old, second 2d+1s old
    put('a.json', JSON.stringify(body('a', '2026-01-03T00:00:00Z', { retention: '2d' })));
    ing.processFile('a.json');
    expect(versions('a')).toHaveLength(1);
    expect(versions('a')[0]).toContain('2026-01-03');
  });

  it('keeps the newest even when older than retention; hourly prune; default on bad retention', () => {
    const { ing, a, tick } = setup('1d');
    a.start();
    put('a.json', JSON.stringify(body('a')));
    ing.processFile('a.json');
    put('b.json', JSON.stringify(body('b', '2026-01-01T00:00:00Z', { retention: '3d' })));
    ing.processFile('b.json');
    clock.advance(30 * DAY);
    tick();
    expect(versions('a')).toHaveLength(1);
    expect(versions('b')).toHaveLength(1);
  });

  it('prunes removed cards by default retention, including the dir', () => {
    const { ing, a, tick } = setup('7d');
    a.start();
    put('a.json', JSON.stringify(body('a', '2026-01-01T00:00:00Z', { retention: '365d' })));
    ing.processFile('a.json');
    rmSync(join(feed, 'a.json'));
    ing.rescan();
    clock.advance(6 * DAY);
    tick();
    expect(versions('a')).toHaveLength(1);
    clock.advance(2 * DAY);
    tick();
    expect(existsSync(join(arch, 'a'))).toBe(false);
  });
});
