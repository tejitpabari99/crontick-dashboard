import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot } from '../src/api/types.ts';
import { COMPLETED_OPEN_KEY } from '../src/constants/storage.ts';
import { Completed, resolveCompleted, type CompletedRow } from '../src/zones/Completed.tsx';
import { snapshotOf, valert, vcard } from './helpers/snapshot.ts';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const noop = () => {};
const rows: CompletedRow[] = [
  { kind: 'card', id: 'c1', title: 'Card One', doneAt: '2026-10-08T10:00:00Z' },
  {
    kind: 'alert',
    id: 'a1',
    item: { id: 'a1', title: 'Alert One', text: 'body', link: 'https://e.com', priority: 3, tickedAt: '2026-10-08T11:30:00Z' },
  },
  { kind: 'alert', id: 'a2', item: { id: 'a2', title: 'Bare', priority: 3, tickedAt: '2026-10-08T11:59:30Z' } },
];

describe('Completed', () => {
  it('renders nothing at n=0', () => {
    const { container } = render(<Completed rows={[]} open onToggle={noop} onReopen={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('header shows count, aria-expanded, toggles via callback', () => {
    const onToggle = vi.fn();
    render(<Completed rows={rows} open onToggle={onToggle} onReopen={noop} />);
    const b = screen.getByRole('button', { name: /Completed \(3\)/ });
    expect(b.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('closed hides rows', () => {
    render(<Completed rows={rows} open={false} onToggle={noop} onReopen={noop} />);
    expect(screen.getByRole('button', { name: /Completed \(3\)/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('rows in given order with ids and formats', () => {
    const onReopen = vi.fn();
    render(<Completed rows={rows} open onToggle={noop} onReopen={onReopen} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-completed-id'))).toEqual(['c1', 'a1', 'a2']);
    expect(items[0]!.id).toBe('completed-card-c1');
    expect(items[0]!.textContent).toContain('Card One');
    expect(items[0]!.textContent).toContain('done 2h ago');
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Reopen' }));
    expect(onReopen).toHaveBeenCalledWith('c1');
    expect(items[1]!.textContent).toContain('body');
    expect(items[1]!.textContent).toContain('ticked 30m ago');
    expect(items[1]!.querySelector('a[href="https://e.com"]')).not.toBeNull();
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(items[2]!.querySelector('a')).toBeNull();
    expect(items[2]!.querySelector('.completed__sep')?.textContent).toBe('·');
    expect(items[2]!.textContent).toContain('ticked just now');
  });
});

function snap(): Snapshot {
  return snapshotOf(
    [
      vcard('c1', 'markdown', { done: true, doneAt: '2026-10-08T10:00:00Z' }),
      vcard('c2', 'markdown', { done: true, doneAt: '2026-10-07T10:00:00Z' }),
      vcard('live', 'markdown'),
    ],
    {
      center: ['live'],
      completed: [
        { kind: 'card', id: 'c1' },
        { kind: 'alert', id: 'a1' },
        { kind: 'card', id: 'c2' },
      ],
      alerts: ['al2'],
    },
    {
      alertItems: [valert('al2')],
      completedAlertItems: [{ id: 'a1', title: 'Ticked', priority: 3, tickedAt: '2026-10-08T11:00:00Z' }],
    },
  );
}

describe('resolveCompleted', () => {
  it('keeps server order and scopes by filter', () => {
    const s = snap();
    expect(resolveCompleted(s, 'all').map((r) => r.id)).toEqual(['c1', 'a1', 'c2']);
    expect(resolveCompleted(s, 'alerts').map((r) => r.id)).toEqual(['a1']);
    expect(resolveCompleted(s, 'cards').map((r) => r.id)).toEqual(['c1', 'c2']);
  });
});

function setup(s: Snapshot) {
  let current = s;
  const fetchFn = vi.fn<typeof fetch>(async (input) =>
    String(input) === '/api/snapshot'
      ? new Response(JSON.stringify(current), { status: 200, headers: { ETag: String(Math.random()) } })
      : new Promise<Response>(() => {}),
  );
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const m = createMutations({ store, toasts, fetch: fetchFn });
  return { fetchFn, store, m, toasts, set: (n: Snapshot) => (current = n) };
}

describe('App Completed integration', () => {
  it('open state persists, survives throwing storage', async () => {
    const t = setup(snap());
    await t.store.refetch();
    const { unmount } = render(<App mutations={t.m} toasts={t.toasts} />);
    const b = screen.getByRole('button', { name: /Completed \(3\)/ });
    expect(b.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(b);
    expect(localStorage.getItem(COMPLETED_OPEN_KEY)).toBe('false');
    unmount();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(screen.getByRole('button', { name: /Completed/ }).getAttribute('aria-expanded')).toBe('false');
    cleanup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('no');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('no');
    });
    render(<App mutations={t.m} toasts={t.toasts} />);
    const b2 = screen.getByRole('button', { name: /Completed/ });
    expect(b2.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(b2);
    expect(screen.getByRole('button', { name: /Completed/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('filter changes counts', async () => {
    const t = setup(snap());
    await t.store.refetch();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(screen.getByRole('button', { name: /Completed \(3\)/ })).toBeTruthy();
    localStorage.setItem('crontick-dashboard.filter', 'alerts');
    cleanup();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(screen.getByRole('button', { name: /Completed \(1\)/ })).toBeTruthy();
    localStorage.setItem('crontick-dashboard.filter', 'cards');
    cleanup();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(screen.getByRole('button', { name: /Completed \(2\)/ })).toBeTruthy();
  });

  it('completed-only page keeps the section, no empty state', async () => {
    const s = snapshotOf([vcard('c1', 'markdown', { done: true, doneAt: '2026-10-08T10:00:00Z' })], {
      completed: [{ kind: 'card', id: 'c1' }],
    });
    const t = setup(s);
    await t.store.refetch();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.getByRole('button', { name: /Completed \(1\)/ })).toBeTruthy();
  });

  it('done moves card to top of Completed; reopen removes it; tick removes alert', async () => {
    const t = setup(snap());
    await t.store.refetch();
    render(<App mutations={t.m} toasts={t.toasts} />);
    expect(document.querySelector('[data-card-id="live"]')).not.toBeNull();
    await act(async () => {
      void t.m.done('live');
    });
    expect(document.querySelector('[data-card-id="live"]')).toBeNull();
    const ids = () => [...document.querySelectorAll('[data-completed-id]')].map((i) => i.getAttribute('data-completed-id'));
    expect(ids()[0]).toBe('live');
    await act(async () => {
      void t.m.reopen('c1');
    });
    expect(ids()).not.toContain('c1');
    expect(document.querySelector('[data-alert-id="al2"]')).not.toBeNull();
    await act(async () => {
      void t.m.tick('al2');
    });
    expect(document.querySelector('[data-alert-id="al2"]')).toBeNull();
    expect(t.fetchFn.mock.calls.some(([u, i]) => String(u) === '/api/cards/c1/done' && i?.method === 'DELETE')).toBe(true);
  });
});
