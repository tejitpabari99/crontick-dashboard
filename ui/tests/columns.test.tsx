import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot, ViewCard } from '../src/api/types.ts';
import { resetExpanded, setExpanded } from '../src/frame/CardFrame.tsx';
import { registerCardType } from '../src/registry/registry.ts';
import { Columns } from '../src/zones/Columns.tsx';
import { snapshotOf, valert, vcard } from './helpers/snapshot.ts';

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-col', { Component: (p: { mode: string; data: { text?: string } }) => <p>{`BODY-${p.mode}-${p.data.text ?? ''}`}</p>, searchText: () => '' });

const card = (id: string, over: Partial<ViewCard> = {}): ViewCard => vcard(id, 'zz-col', over);

const common = {
  query: '',
  matchIds: null,
  checked: () => new Set<string>() as ReadonlySet<string>,
  pending: () => new Set<string>() as ReadonlySet<string>,
  nowPriorityThreshold: 5,
  onItemAction: async () => {},
  onDone: () => {},
  onHide: () => {},
  onFullscreen: () => {},
};

const ids = (root: Element): string[] => [...root.querySelectorAll('[data-card-id]')].map((e) => e.getAttribute('data-card-id')!);
const col = (name: string) => document.querySelector(`[data-column="${name}"]`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  resetExpanded();
});
afterEach(cleanup);

describe('Columns', () => {
  it('renders each column in snapshot order (no client sort), DOM order center, left, right', () => {
    const cards = [card('c2', { priority: 1 }), card('c1', { priority: 9 }), card('l2'), card('l1'), card('r1')];
    render(
      <Columns
        columns={{ center: [cards[0]!, cards[1]!], left: [cards[2]!, cards[3]!], right: [cards[4]!] }}
        now={[]}
        {...common}
      />,
    );
    expect([...document.querySelectorAll('[data-column]')].map((e) => e.getAttribute('data-column'))).toEqual(['center', 'left', 'right']);
    expect(ids(col('center'))).toEqual(['c2', 'c1']);
    expect(ids(col('left'))).toEqual(['l2', 'l1']);
    expect(ids(col('right'))).toEqual(['r1']);
  });

  it('Now is the first child of center and its card is absent from the columns', () => {
    render(<Columns columns={{ center: [card('c1')], left: [card('l1')], right: [] }} now={[card('n1')]} {...common} />);
    const center = col('center');
    expect(center.firstElementChild?.getAttribute('data-testid')).toBe('now-zone');
    expect(ids(center)).toEqual(['n1', 'c1']);
    expect(document.querySelectorAll('[data-card-id="n1"]')).toHaveLength(1);
  });

  it('an empty column still renders its element', () => {
    render(<Columns columns={{ center: [card('c1')], left: [], right: [] }} now={[]} {...common} />);
    expect(col('left')).toBeTruthy();
    expect(col('left').children).toHaveLength(0);
    expect(col('right')).toBeTruthy();
  });

  it('collapsed card renders a chip; expanding swaps in the frame, collapse swaps back', () => {
    render(<Columns columns={{ center: [card('q', { collapsed: true, priority: 1 })], left: [], right: [] }} now={[]} {...common} />);
    const chip = screen.getByRole('button', { name: 'Expand T-q' });
    expect(chip.classList.contains('chip--collapsed')).toBe(true);
    expect(screen.queryByText(/BODY-/)).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText('BODY-column-')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.getByRole('button', { name: 'Expand T-q' })).toBeTruthy();
  });

  it('reacts to setExpanded called elsewhere', () => {
    render(<Columns columns={{ center: [card('q', { collapsed: true })], left: [], right: [] }} now={[]} {...common} />);
    act(() => setExpanded('q', true));
    expect(screen.getByText('BODY-column-')).toBeTruthy();
  });

  it('poll with changed data keeps element identity and order', () => {
    const cols = (text: string) => ({ center: [card('a', { data: { text } }), card('b')], left: [], right: [] });
    const { rerender } = render(<Columns columns={cols('one')} now={[]} {...common} />);
    const before = [...document.querySelectorAll('[data-card-id]')];
    rerender(<Columns columns={cols('two')} now={[]} {...common} />);
    const after = [...document.querySelectorAll('[data-card-id]')];
    expect(after).toEqual(before);
    expect(screen.getByText('BODY-column-two')).toBeTruthy();
  });
});

function mountApp(snap: Snapshot) {
  const fetchFn = vi.fn<typeof fetch>(async (input) =>
    String(input) === '/api/snapshot'
      ? new Response(JSON.stringify(snap), { status: 200, headers: { ETag: 'x' } })
      : new Response('{}', { status: 200 }),
  );
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  render(<App mutations={createMutations({ store, toasts, fetch: fetchFn })} toasts={toasts} />);
}

describe('App page shell', () => {
  it('main.page holds alert strip then columns', async () => {
    mountApp(snapshotOf([card('c1')], { center: ['c1'], alerts: ['al'] }, { alertItems: [valert('al')] }));
    await screen.findByText('T-c1');
    const main = document.querySelector('main.page')!;
    expect(main).toBeTruthy();
    expect([...main.children].map((e) => e.className.split(' ')[0])).toEqual(['alert-strip', 'columns']);
    expect(screen.getByText('A-al')).toBeTruthy();
  });

  it('empty page shows "No cards yet"', async () => {
    mountApp(snapshotOf([]));
    await screen.findByText('No cards yet');
    expect(document.querySelector('.columns')).toBeNull();
  });

  it('hidden-only keeps the page with the header popover', async () => {
    mountApp(snapshotOf([card('h')], { hidden: ['h'] }));
    await screen.findByRole('button', { name: /hidden \(1\)/i });
    expect(screen.queryByText('No cards yet')).toBeNull();
    expect(document.querySelector('.columns')).toBeTruthy();
  });

  it('completed-only keeps the page', async () => {
    mountApp(snapshotOf([card('d', { done: true })], { completed: [{ kind: 'card', id: 'd' }] }));
    await screen.findByRole('searchbox');
    expect(screen.queryByText('No cards yet')).toBeNull();
    expect(document.querySelector('.columns')).toBeTruthy();
  });
});
