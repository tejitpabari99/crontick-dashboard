import { POLL_DEFAULT_MS } from '../../src/constants/poll.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { LayoutItem, Snapshot, ViewCard } from '../src/api/types.ts';
import { markSeen } from '../src/lib/seen.ts';
import { registerCardType } from '../src/registry/registry.ts';

const captured: { layout: LayoutItem[] } = { layout: [] };

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
  verticalCompactor: {},
  GridLayout: (props: { layout: LayoutItem[]; children: unknown }) => {
    captured.layout = props.layout;
    return <div data-testid="rgl">{props.children as never}</div>;
  },
}));

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-hdr', {
  Component: (p: { query: string; data: { text?: string } }) => (
    <p data-testid="body">{`q=${p.query}|${p.data.text ?? ''}`}</p>
  ),
  searchText: (d: { text?: string }) => d.text ?? '',
});

function card(id: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    kind: 'panel',
    type: 'zz-hdr',
    title: `T-${id}`,
    priority: 3,
    notify: false,
    updatedAt: '2026-10-05T10:00:00Z',
    collapsed: false,
    status: 'ok',
    data: { text: '' },
    ...over,
  };
}

const L = (i: string, x: number, y: number): LayoutItem => ({ i, x, y, w: 3, h: 7 });

function base(): Snapshot {
  const cards = [
    card('a', { title: 'Alpha', data: { text: 'Dana was here' } }),
    card('b', { title: 'Beta', data: { text: 'other' } }),
    card('c', { title: 'Gamma', data: { text: 'dana done' } }),
    card('h', { title: 'Hid', data: { text: 'DANA hidden' } }),
  ];
  return {
    serverTime: 't',
    rev: 'r',
    warnings: [],
    config: { pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: 5 },
    zones: { alerts: [], now: [], grid: ['a', 'b'], tray: ['c'], hidden: ['h'] },
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    layout: [L('a', 3, 4), L('b', 6, 0), L('h', 9, 2)],
  };
}

function mount(initial: Snapshot = base()) {
  let current = initial;
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/snapshot') {
      return new Response(JSON.stringify(current), { status: 200, headers: { ETag: String(Math.random()) } });
    }
    const mm = /\/api\/cards\/([^/]+)\/hidden/.exec(url);
    if (mm) {
      const id = mm[1]!;
      const z = current.zones;
      current = {
        ...current,
        zones:
          method === 'PUT'
            ? { ...z, grid: z.grid.filter((x) => x !== id), hidden: [...z.hidden, id] }
            : { ...z, hidden: z.hidden.filter((x) => x !== id), grid: [...z.grid, id] },
      };
    }
    return new Response('{}', { status: 200 });
  });
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const mutations = createMutations({ store, toasts, fetch: fetchFn });
  render(<App mutations={mutations} toasts={toasts} />);
  return { toasts, setCurrent: (s: Snapshot) => (current = s) };
}

const box = () => screen.getByRole('searchbox', { name: /search/i }) as HTMLInputElement;
const frame = (id: string) => document.querySelector(`section[data-card-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.title = '';
});
afterEach(cleanup);

describe('Header search', () => {
  it('dims non-matches and outlines matches with no layout change; query reaches bodies', async () => {
    mount();
    await screen.findByText('Alpha');
    const before = JSON.stringify(captured.layout);
    fireEvent.change(box(), { target: { value: 'dana' } });
    expect(frame('a').className).toContain('card-frame--match');
    expect(frame('a').className).not.toContain('card-frame--dim');
    expect(frame('b').className).toContain('card-frame--dim');
    expect(frame('b').className).not.toContain('card-frame--match');
    expect(JSON.stringify(captured.layout)).toBe(before);
    expect(screen.getByText('3 matches')).toBeTruthy();
    expect(within(frame('a')).getByTestId('body').textContent).toContain('q=dana');
    fireEvent.change(box(), { target: { value: '' } });
    expect(frame('b').className).not.toContain('card-frame--dim');
    expect(JSON.stringify(captured.layout)).toBe(before);
  });

  it('lists tray and hidden matches in a dropdown with open and unhide', async () => {
    mount();
    await screen.findByText('Alpha');
    fireEvent.change(box(), { target: { value: 'dana' } });
    const dd = screen.getByRole('list', { name: /other matches/i });
    expect(within(dd).getByText('Gamma')).toBeTruthy();
    expect(within(dd).getByText('Hid')).toBeTruthy();
    fireEvent.click(within(dd).getByRole('button', { name: /unhide hid/i }));
    await waitFor(() => expect(frame('h')).toBeTruthy());
  });

  it('Enter / Shift+Enter cycle matches and focus them', async () => {
    mount();
    await screen.findByText('Alpha');
    fireEvent.change(box(), { target: { value: 'a' } }); // Alpha and Beta both match
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(document.activeElement).toBe(frame('a'));
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(document.activeElement).toBe(frame('b'));
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(document.activeElement).toBe(frame('a'));
  });
});

describe('shortcuts', () => {
  it('/, S and Ctrl+K focus the search when focus is outside inputs', async () => {
    mount();
    await screen.findByText('Alpha');
    for (const ev of [
      { key: '/' },
      { key: 's' },
      { key: 'S' },
      { key: 'k', ctrlKey: true },
      { key: 'k', metaKey: true },
    ]) {
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.keyDown(document.body, ev);
      expect(document.activeElement).toBe(box());
    }
  });

  it('S does not steal focus or get swallowed inside inputs / contenteditable', async () => {
    mount();
    await screen.findByText('Alpha');
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    const notPrevented = fireEvent.keyDown(other, { key: 's' });
    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(other);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: 'S' });
    expect(document.activeElement).toBe(ta);
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    ce.tabIndex = 0;
    document.body.appendChild(ce);
    ce.focus();
    fireEvent.keyDown(ce, { key: '/' });
    expect(document.activeElement).toBe(ce);
    // Typing S in the search box itself stays in the box
    box().focus();
    fireEvent.keyDown(box(), { key: 's' });
    expect(document.activeElement).toBe(box());
    other.remove();
    ta.remove();
    ce.remove();
  });

  it('Esc clears text first, then blurs; Esc on empty blurs', async () => {
    mount();
    await screen.findByText('Alpha');
    box().focus();
    fireEvent.change(box(), { target: { value: 'dana' } });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().value).toBe('');
    expect(document.activeElement).toBe(box());
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(document.activeElement).not.toBe(box());
    box().focus();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(document.activeElement).not.toBe(box());
  });
});

describe('Hidden popover', () => {
  it('hide -> popover -> unhide restores the stored slot', async () => {
    mount();
    await screen.findByText('Alpha');
    expect(screen.getByRole('button', { name: /hidden \(1\)/i })).toBeTruthy();
    fireEvent.click(within(frame('a')).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(frame('a')).toBeNull());
    const entry = captured.layout.find((l) => l.i === 'a');
    expect(entry).toBeUndefined(); // not rendered while hidden
    fireEvent.click(screen.getByRole('button', { name: /hidden \(2\)/i }));
    const pop = screen.getByRole('dialog', { name: /hidden cards/i });
    expect(within(pop).getByText('Hid')).toBeTruthy();
    fireEvent.click(within(pop).getByRole('button', { name: /unhide alpha/i }));
    await waitFor(() => expect(frame('a')).toBeTruthy());
    expect(captured.layout.find((l) => l.i === 'a')).toMatchObject({ x: 3, y: 4, w: 3, h: 7 });
  });
});

describe('title count', () => {
  it('is alerts + unseen notify cards', async () => {
    const s = base();
    s.cards['al'] = card('al', { kind: 'alert', title: 'Alert!' });
    s.cards['n'] = card('n', { notify: true, title: 'Notify' });
    s.zones = { ...s.zones, alerts: ['al'], grid: ['a', 'b', 'n'] };
    mount(s);
    await screen.findByText('Notify');
    await waitFor(() => expect(document.title).toBe('(2) Crontick'));
    expect(screen.getByRole('button', { name: /1 alert/i })).toBeTruthy();
  });

  it('drops the count when a notify card is seen, without any snapshot change', async () => {
    const s = base();
    s.cards['n'] = card('n', { notify: true, title: 'Notify' });
    s.zones = { ...s.zones, grid: ['a', 'b', 'n'] };
    mount(s);
    await screen.findByText('Notify');
    await waitFor(() => expect(document.title).toBe('(1) Crontick'));
    act(() => markSeen({ id: 'n', updatedAt: s.cards['n']!.updatedAt }));
    expect(document.title).toBe('Crontick'); // synchronous: no snapshot/poll re-render involved
  });

  it('is plain when nothing needs attention', async () => {
    mount();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.title).toBe('Crontick'));
  });
});

describe('header misc', () => {
  it('connection dot reflects failures; toast host renders toasts', async () => {
    const { toasts } = mount();
    await screen.findByText('Alpha');
    expect(screen.getByRole('img', { name: /connected/i })).toBeTruthy();
    act(() => void toasts.push('boom'));
    expect(screen.getByText('boom')).toBeTruthy();
  });
});
