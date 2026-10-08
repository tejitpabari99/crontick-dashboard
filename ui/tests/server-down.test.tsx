import axe from 'axe-core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import { DOWN_BACKOFF_MS } from '../src/constants/polling.ts';
import type { Snapshot, ViewCard } from '../src/api/types.ts';
import { snapshotOf, valert, vcard, type Placement } from './helpers/snapshot.ts';
import '../src/types/index.ts';
import table from '../../templates/table.example.json';
import list from '../../templates/list.example.json';
import media from '../../templates/media.example.json';

const card = (id: string, over: Partial<ViewCard> = {}): ViewCard =>
  vcard(id, 'markdown', { title: `Title-${id}`, data: { text: `Data-${id}` } as never, ...over });

const snapshot = (cards: ViewCard[], p: Placement, alertIds: string[] = []): Snapshot =>
  snapshotOf(cards, p, { alertItems: alertIds.map((id) => valert(id, { title: `Title-${id}` })) });

const FIXTURE = snapshot(
  [
    card('md', { type: 'markdown' }),
    card('tb', { type: 'table', data: table.data as never }),
    card('ls', { type: 'list', data: list.data as never }),
    card('kp', { type: 'kpi', data: { items: [{ label: 'Data-kp', value: 1 }] } as never }),
    card('me', { type: 'media', data: media.data as never }),
    card('br', { status: 'broken', reason: 'schema-invalid', message: 'bad data', data: undefined }),
    card('tr', { done: true, doneAt: '2026-10-05T11:00:00Z' }),
    card('hi'),
  ],
  { now: ['kp'], center: ['md', 'tb'], left: ['ls'], right: ['me', 'br'], hidden: ['hi'], alerts: ['al'], completed: [{ kind: 'card', id: 'tr' }] },
  ['al'],
);

interface Timer {
  cb: () => void;
  ms: number;
}

function mount(initial: Snapshot = FIXTURE) {
  const state = { mode: 'ok' as 'ok' | 'fail', now: 1_000_000 };
  const timers: Timer[] = [];
  const hang = new Set<string>();
  const fetchFn = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/snapshot') {
      if (state.mode === 'fail') throw new TypeError('down');
      return new Response(JSON.stringify(initial), { status: 200, headers: { ETag: String(Math.random()) } });
    }
    hang.add(url);
    return new Promise<Response>(() => undefined);
  });
  const store = createSnapshotStore({
    client: createClient({ fetch: fetchFn }),
    doc: undefined,
    now: () => state.now,
    setTimeout: (cb, ms) => {
      const t = { cb, ms };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      const i = timers.indexOf(h as Timer);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const toasts = createToastStore();
  const mutations = createMutations({ store, toasts, fetch: fetchFn });
  const view = render(<App mutations={mutations} toasts={toasts} />);
  const fire = async (): Promise<number> => {
    const t = timers.pop()!;
    await act(async () => {
      t.cb();
      await Promise.resolve();
    });
    await act(async () => undefined);
    return timers.at(-1)?.ms ?? -1;
  };
  return { state, timers, store, mutations, fire, ...view };
}

beforeEach(() => {
  localStorage.clear();
  document.title = '';
});
afterEach(cleanup);

const CACHED = ['Title-md', 'Data-md', 'Title-hi', 'Data-hi', 'Title-tr', 'Title-al', 'Data-kp', 'bad data'];

describe('server down', () => {
  it('after 2 failures renders only the Server down page, drops cached data, backs off, recovers', async () => {
    const t = mount();
    await screen.findByText('Title-md');
    expect(document.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);

    t.state.mode = 'fail';
    await t.fire(); // failure 1: UI stays
    expect(screen.queryByText('Server down')).toBeNull();
    expect(screen.getByText('Title-md')).toBeTruthy();
    const ms1 = await t.fire(); // failure 2: down
    expect(ms1).toBe(DOWN_BACKOFF_MS[0]);

    expect(document.querySelectorAll('[data-card-id]').length).toBe(0);
    for (const s of CACHED) expect(document.body.textContent).not.toContain(s);
    expect(screen.getByRole('heading', { name: 'Server down' })).toBeTruthy();
    expect(screen.getByText(/Retrying every 5 s/)).toBeTruthy();
    expect(screen.getByText('crontick-dashboard daemon start')).toBeTruthy();
    expect(document.title).toBe('Server down');
    expect(t.store.getSnapshot().snapshot).toBeNull();

    // header reduced to theme toggle + red dot
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /hidden/i })).toBeNull();
    expect(screen.getByRole('button', { name: /theme/i })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Connection problem' }).className).toContain('header__dot--bad');
    expect(document.querySelectorAll('header button').length).toBe(1);

    // backoff 5 -> 10 -> 30 -> 30
    expect(await t.fire()).toBe(DOWN_BACKOFF_MS[1]);
    expect(screen.getByText(/Retrying every 10 s/)).toBeTruthy();
    expect(await t.fire()).toBe(DOWN_BACKOFF_MS[2]);
    expect(await t.fire()).toBe(DOWN_BACKOFF_MS[2]);

    // recovery without reload
    t.state.mode = 'ok';
    await t.fire();
    await screen.findByText('Title-md');
    expect(screen.queryByText('Server down')).toBeNull();
    expect(document.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);
    expect(document.title).not.toBe('Server down');
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('down when more than 2x poll interval since last success', async () => {
    const t = mount();
    await screen.findByText('Title-md');
    t.state.mode = 'fail';
    t.state.now += 61_000;
    await t.fire();
    expect(screen.getByRole('heading', { name: 'Server down' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Title-md');
  });

  it('discards optimistic patches and pending sets', async () => {
    const t = mount();
    await screen.findByText('Title-md');
    const off = t.mutations.subscribe(() => undefined);
    void t.mutations.hide('md');
    void t.mutations.onItemAction('md', 'i1');
    await act(async () => undefined);
    expect(t.mutations.getView().pending.get('md')?.has('i1')).toBe(true);
    t.state.mode = 'fail';
    await t.fire();
    await t.fire();
    const v = t.mutations.getView();
    expect(v.state.snapshot).toBeNull();
    expect(v.pending.size).toBe(0);
    t.state.mode = 'ok';
    await t.fire();
    await screen.findByText('Title-md'); // not hidden: patch was discarded
    expect(t.mutations.getView().pending.size).toBe(0);
    expect(t.mutations.getChecked('md').size).toBe(0);
    off();
  });
});

describe('first load failure', () => {
  it('shows Server down immediately', async () => {
    const t = mount();
    t.unmount();
    cleanup();
    const state = { calls: 0 };
    const fetchFn = vi.fn<typeof fetch>(async () => {
      state.calls++;
      throw new TypeError('down');
    });
    const timers: Timer[] = [];
    const store = createSnapshotStore({
      client: createClient({ fetch: fetchFn }),
      doc: undefined,
      setTimeout: (cb, ms) => {
        const x = { cb, ms };
        timers.push(x);
        return x;
      },
    });
    const toasts = createToastStore();
    render(<App mutations={createMutations({ store, toasts, fetch: fetchFn })} toasts={toasts} />);
    await screen.findByRole('heading', { name: 'Server down' });
    expect(screen.getByText(/Retrying every 5 s/)).toBeTruthy();
    expect(document.title).toBe('Server down');
  });
});

describe('empty state', () => {
  it('shows the info hint when no zone has a card', async () => {
    mount(snapshot([], {}));
    await screen.findByText('crontick-dashboard info');
    expect(document.querySelectorAll('[data-card-id]').length).toBe(0);
  });
});

describe('a11y', () => {
  it('has landmarks and labelled sections', async () => {
    mount();
    await screen.findByText('Title-md');
    expect([...document.querySelectorAll('header')].filter((h) => !h.closest('section,article')).length).toBe(1);
    expect(document.querySelectorAll('main').length).toBe(1);
    for (const s of document.querySelectorAll('main section')) {
      expect(s.getAttribute('aria-labelledby') ?? s.getAttribute('aria-label')).toBeTruthy();
    }
    expect(document.querySelector('section[aria-labelledby]')).toBeTruthy();
  });

  it('axe finds no critical violations on the shell with fixtures', async () => {
    mount();
    await screen.findByText('Title-md');
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    const critical = res.violations.filter((v) => v.impact === 'critical');
    expect(critical.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });

  it('axe finds no critical violations on the Server down page', async () => {
    const t = mount();
    await screen.findByText('Title-md');
    t.state.mode = 'fail';
    await t.fire();
    await t.fire();
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.filter((v) => v.impact === 'critical')).toEqual([]);
    expect(document.querySelectorAll('main').length).toBe(1);
  });
});
