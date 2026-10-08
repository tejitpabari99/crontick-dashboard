import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedIngest, type AlertChange } from '../../src/feed/ingest.js';
import { FEED_SETTLE_DELAYS_MS } from '../../src/constants/feed.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alerts-'));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const put = (path: string, text: string, mtimeSec?: number) => {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
  if (mtimeSec !== undefined) utimesSync(full, mtimeSec, mtimeSec);
};
const alert = (extra: object = {}) => JSON.stringify({ title: 'Disk full', ...extra });

function setup() {
  const changes: AlertChange[] = [];
  const ing = createFeedIngest({ feedDir: dir, onAlertChange: (c) => changes.push(c) });
  return { ing, changes };
}

describe('alert ingest', () => {
  it('add, change, remove', () => {
    const { ing, changes } = setup();
    put('alerts/a.json', alert({ text: 'x' }));
    ing.processAlert('a.json');
    expect(ing.alerts.get('a')).toMatchObject({ status: 'ok', key: 'a', file: 'alerts/a.json' });
    put('alerts/a.json', alert({ text: 'y' }));
    ing.processAlert('a.json');
    ing.processAlert('a.json'); // unchanged bytes: no event
    unlinkSync(join(dir, 'alerts/a.json'));
    ing.processAlert('a.json');
    expect(changes.map((c) => [c.type, c.contentChanged])).toEqual([
      ['new', true],
      ['changed', true],
      ['removed', false],
    ]);
    expect(ing.alerts.list()).toHaveLength(0);
  });

  it('alert without text loads', () => {
    const { ing } = setup();
    put('alerts/n.json', alert());
    ing.processAlert('n.json');
    const e = ing.alerts.get('n');
    expect(e?.status).toBe('ok');
    if (e?.status === 'ok') expect(e.alert.text).toBeUndefined();
  });

  it('schema-invalid alert is a broken row with parsed title', () => {
    const { ing, changes } = setup();
    put('alerts/b.json', JSON.stringify({ title: 'Oops', priority: 'high' }));
    ing.processAlert('b.json');
    expect(ing.alerts.get('b')).toMatchObject({ status: 'broken', id: 'b', title: 'Oops', reason: 'schema-invalid' });
    expect(changes).toHaveLength(1);
  });

  it('malformed JSON settles then becomes broken; a fix in time loads ok', () => {
    const { ing, changes } = setup();
    put('alerts/m.json', '{"title": ');
    ing.processAlert('m.json');
    expect(ing.alerts.get('m')).toBeUndefined();
    put('alerts/m.json', alert());
    ing.processAlert('m.json');
    expect(ing.alerts.get('m')).toMatchObject({ status: 'ok' });
    put('alerts/z.json', '{"title": ');
    ing.processAlert('z.json');
    vi.advanceTimersByTime(FEED_SETTLE_DELAYS_MS[FEED_SETTLE_DELAYS_MS.length - 1] as number + 50);
    expect(ing.alerts.get('z')).toMatchObject({ status: 'broken', title: 'z', reason: 'malformed-json' });
    expect(changes.map((c) => c.key)).toEqual(['m', 'z']);
    ing.dispose();
  });

  it('.done pickup: tickedAt = mtime, no alert change, invalid skipped silently', () => {
    const { ing, changes } = setup();
    put('alerts/.done/t.json', alert({ text: 'tx', link: 'https://e.com', priority: 3 }), 1_700_000_000);
    put('alerts/.done/bad.json', '{nope');
    put('alerts/.done/bad2.json', JSON.stringify({ text: 'no title' }));
    ing.processCompletedAlert('t.json');
    ing.processCompletedAlert('bad.json');
    ing.processCompletedAlert('bad2.json');
    expect(ing.completedAlerts.list()).toHaveLength(1);
    expect(ing.completedAlerts.get('t')).toMatchObject({
      key: 't',
      title: 'Disk full',
      text: 'tx',
      link: 'https://e.com',
      priority: 3,
      tickedAt: new Date(1_700_000_000_000).toISOString(),
    });
    expect(changes).toHaveLength(0);
    expect(ing.alerts.list()).toHaveLength(0);
    expect(ing.issues()).toEqual([]);
  });

  it('ignores dot, .tmp and non-json names in alerts/', () => {
    const { ing } = setup();
    put('alerts/.hidden.json', alert());
    put('alerts/w.json.tmp', alert());
    put('alerts/readme.txt', 'hi');
    put('alerts/.done/.x.json', alert());
    for (const n of ['.hidden.json', 'w.json.tmp', 'readme.txt']) ing.processAlert(n);
    ing.processCompletedAlert('.x.json');
    ing.rescan();
    expect(ing.alerts.list()).toHaveLength(0);
    expect(ing.completedAlerts.list()).toHaveLength(0);
    expect(ing.issues()).toEqual([]);
  });

  it('rescan covers alerts/ and .done/ and drops vanished files', () => {
    const { ing, changes } = setup();
    put('alerts/a.json', alert());
    put('alerts/.done/d.json', alert());
    ing.rescan();
    expect(ing.alerts.list().map((e) => e.key)).toEqual(['a']);
    expect(ing.completedAlerts.list().map((e) => e.key)).toEqual(['d']);
    unlinkSync(join(dir, 'alerts/a.json'));
    unlinkSync(join(dir, 'alerts/.done/d.json'));
    ing.rescan();
    expect(ing.alerts.list()).toHaveLength(0);
    expect(ing.completedAlerts.list()).toHaveLength(0);
    expect(changes.map((c) => c.type)).toEqual(['new', 'removed']);
    expect(ing.store.list()).toHaveLength(0); // `alerts` never a card
  });
});
