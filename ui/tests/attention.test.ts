import { beforeEach, describe, expect, it } from 'vitest';
import { attentionCount } from '../src/lib/attention.ts';
import { markSeen } from '../src/lib/seen.ts';
import type { Snapshot } from '../src/api/types.ts';

const c = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'list', title: id, priority: 1, notify: true, updatedAt: 'u1', column: 'left', height: 'M',
  status: 'ok', collapsed: false, done: false, ...over,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    columns: { left: ['a', 'nd'], center: ['quiet'], right: [] },
    now: ['n'],
    alerts: ['al1', 'al2'],
    cards: {
      a: c('a'), n: c('n'), nd: c('nd', { status: 'no-data', updatedAt: undefined }),
      quiet: c('quiet', { notify: false }), done: c('done', { done: true }),
    },
    ...over,
  }) as unknown as Snapshot;

beforeEach(() => localStorage.clear());

describe('attentionCount', () => {
  it('alerts + unseen notify cards in now and columns; excludes no-data, non-notify, Done', () => {
    expect(attentionCount(snap())).toBe(4);
  });
  it('seen cards drop out', () => {
    markSeen({ id: 'a', updatedAt: 'u1' });
    expect(attentionCount(snap())).toBe(3);
  });
  it('does not double count a card present in now and a column', () => {
    expect(attentionCount(snap({ now: ['a'] }))).toBe(3);
  });
});
