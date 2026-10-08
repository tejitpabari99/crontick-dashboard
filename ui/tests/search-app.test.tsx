import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot } from '../src/api/types.ts';
import { COMPLETED_OPEN_KEY, FILTER_KEY } from '../src/constants/storage.ts';
import { registerCardType } from '../src/registry/registry.ts';
import { snapshotOf, valert, vcard } from './helpers/snapshot.ts';

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-sa', { Component: () => <p>body</p>, searchText: () => '' });

const c = (id: string, title: string, over = {}) => vcard(id, 'zz-sa', { title, ...over });

function snap(): Snapshot {
  return snapshotOf(
    [
      c('n1', 'zebra now', { priority: 8 }),
      c('c1', 'zebra center'),
      c('l1', 'zebra left', { column: 'left' }),
      c('r1', 'zebra right', { column: 'right' }),
      c('chip', 'zebra chip', { collapsed: true, column: 'left' }),
      c('h1', 'zebra hidden'),
      c('d1', 'zebra done', { done: true, doneAt: '2026-10-05T11:00:00Z' }),
    ],
    {
      now: ['n1'],
      center: ['c1'],
      left: ['l1', 'chip'],
      right: ['r1'],
      alerts: ['al'],
      hidden: ['h1'],
      completed: [{ kind: 'card', id: 'd1' }, { kind: 'alert', id: 'ca' }],
    },
    {
      alertItems: [valert('al', { title: 'Disk', text: 'zebra nearly full' })],
      completedAlertItems: [{ id: 'ca', title: 'Old alert', text: 'zebra gone', tickedAt: '2026-10-05T11:00:00Z' } as never],
    },
  );
}

function mount() {
  const fetchFn = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(snap()), { status: 200, headers: { ETag: 'e' } }),
  );
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const mutations = createMutations({ store, toasts, fetch: fetchFn });
  render(<App mutations={mutations} toasts={toasts} />);
  return { toasts };
}
const box = () => screen.getByRole('searchbox', { name: /search/i }) as HTMLInputElement;
const search = (q: string) => fireEvent.change(box(), { target: { value: q } });
const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement;
const row = (kind: string, id: string) => document.getElementById(`completed-${kind}-${id}`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('search scope', () => {
  it('outlines a collapsed chip without expanding it; alerts match by text', async () => {
    mount();
    await screen.findByText('zebra center');
    search('zebra');
    expect(card('chip').className).toContain('card-frame--match');
    expect(card('chip').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-alert-id="al"]')!.className).toContain('card-frame--match');
    search('nearly');
    expect(document.querySelector('[data-alert-id="al"]')!.className).toContain('card-frame--match');
    expect(card('c1').className).toContain('card-frame--dim');
  });

  it('Enter cycles alerts, now, center, left, right, completed', async () => {
    mount();
    await screen.findByText('zebra center');
    search('zebra');
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      fireEvent.keyDown(box(), { key: 'Enter' });
      const a = document.activeElement as HTMLElement;
      seen.push(a.dataset.alertId ?? a.dataset.cardId ?? `${a.dataset.completedKind}:${a.dataset.completedId}`);
    }
    expect(seen).toEqual(['al', 'n1', 'c1', 'l1', 'chip', 'r1', 'card:d1', 'alert:ca']);
  });

  it('total = visible + other matches (hidden)', async () => {
    mount();
    await screen.findByText('zebra center');
    search('zebra');
    expect(screen.getByText('9 matches')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Other matches' })).getByText('zebra hidden')).toBeTruthy();
  });

  it('closed Completed matches go to Other matches; Show opens, scrolls, highlights', async () => {
    localStorage.setItem(COMPLETED_OPEN_KEY, 'false');
    mount();
    await screen.findByText('zebra center');
    search('zebra done');
    const list = screen.getByRole('list', { name: 'Other matches' });
    expect(within(list).getByText('Completed')).toBeTruthy();
    expect(screen.getByText('1 match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show zebra done' }));
    await waitFor(() => expect(row('card', 'd1').className).toContain('card-highlight'));
    expect(localStorage.getItem(COMPLETED_OPEN_KEY)).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(row('card', 'd1').className).toContain('card-frame--match');
  });

  it('scope follows the filter', async () => {
    localStorage.setItem(FILTER_KEY, 'cards');
    mount();
    await screen.findByText('zebra center');
    search('zebra');
    expect(document.querySelector('[data-alert-id]')).toBeNull();
    expect(row('alert', 'ca')).toBeNull();
    expect(screen.getByText('7 matches')).toBeTruthy();
  });
});

describe('deep link', () => {
  it('collapsed chip is scrolled to and highlighted', async () => {
    mount();
    await screen.findByText('zebra center');
    act(() => void (location.hash = '#card=chip'));
    await waitFor(() => expect(card('chip').className).toContain('card-highlight'));
  });

  it('done card: switches to All, opens Completed, highlights row, no toast', async () => {
    localStorage.setItem(FILTER_KEY, 'alerts');
    localStorage.setItem(COMPLETED_OPEN_KEY, 'false');
    const { toasts } = mount();
    await screen.findByText('Disk');
    act(() => void (location.hash = '#card=d1'));
    await waitFor(() => expect(row('card', 'd1')?.className).toContain('card-highlight'));
    expect(localStorage.getItem(FILTER_KEY)).toBe('all');
    expect(toasts.getSnapshot()).toEqual([]);
    expect(location.hash).toBe('');
  });

  it('hidden and unknown still toast', async () => {
    const { toasts } = mount();
    await screen.findByText('zebra center');
    act(() => void (location.hash = '#card=h1'));
    await screen.findByText('zebra hidden is hidden');
    act(() => void (location.hash = '#card=ghost'));
    await screen.findByText('card not found');
    expect(toasts.getSnapshot().length).toBe(2);
  });
});
