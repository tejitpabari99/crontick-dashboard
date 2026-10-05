import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { LayoutItem, Snapshot, ViewCard } from '../src/api/types.ts';
import { registerCardType } from '../src/registry/registry.ts';

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
  verticalCompactor: {},
  GridLayout: (props: { children: unknown }) => <div data-testid="rgl">{props.children as never}</div>,
}));

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-fs', {
  Component: (p: { query: string; mode: string }) => <p data-testid="body">{`mode=${p.mode}|q=${p.query}`}</p>,
  searchText: () => '',
});

function card(id: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    kind: 'panel',
    type: 'zz-fs',
    title: `T-${id}`,
    priority: 3,
    notify: false,
    updatedAt: '2026-10-05T10:00:00Z',
    collapsed: false,
    status: 'ok',
    data: {},
    ...over,
  };
}

const L = (i: string, x: number, y: number): LayoutItem => ({ i, x, y, w: 3, h: 7 });

function snapshot(): Snapshot {
  const cards = [card('a'), card('b'), card('n', { priority: 8 }), card('al', { kind: 'alert' }), card('d'), card('h')];
  return {
    serverTime: 't',
    rev: 'r',
    warnings: [],
    config: { pollIntervalMs: 30000, nowPriorityThreshold: 5 },
    zones: { alerts: ['al'], now: ['n'], grid: ['a', 'b'], tray: ['d'], hidden: ['h'] },
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    layout: [L('a', 0, 0), L('b', 3, 0)],
  };
}

function mount() {
  const fetchFn = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === '/api/snapshot') {
      return new Response(JSON.stringify(snapshot()), { status: 200, headers: { ETag: 'x' } });
    }
    return new Response('{}', { status: 200 });
  });
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const mutations = createMutations({ store, toasts, fetch: fetchFn });
  render(<App mutations={mutations} toasts={toasts} />);
  return { toasts };
}

const messages = (t: ReturnType<typeof createToastStore>) => t.getSnapshot().map((x) => x.message);
const dlg = () => document.querySelector('dialog');
const frame = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  // jsdom lacks showModal/close: minimal polyfill.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Fullscreen', () => {
  it('opens via the button (sets hash), renders mode fullscreen, closes clearing the hash, restores focus', async () => {
    mount();
    await screen.findByText('T-a');
    const btn = frame('a').querySelector('button[aria-label="Fullscreen"]') as HTMLButtonElement;
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(dlg()).toBeTruthy());
    expect(location.hash).toBe('#card=a&view=full');
    expect(dlg()!.querySelector('[data-testid="body"]')!.textContent).toContain('mode=fullscreen');
    // focus moves into the dialog (as showModal would)
    (dlg()!.querySelector('button') as HTMLButtonElement).focus();
    fireEvent.click(screen.getByRole('button', { name: /close fullscreen/i }));
    await waitFor(() => expect(dlg()).toBeNull());
    expect(location.hash).toBe('');
    expect(document.activeElement).toBe(btn);
  });

  it('Esc (cancel event) closes and clears the hash', async () => {
    mount();
    await screen.findByText('T-a');
    fireEvent.click(frame('a').querySelector('button[aria-label="Fullscreen"]')!);
    await waitFor(() => expect(dlg()).toBeTruthy());
    fireEvent(dlg()!, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dlg()).toBeNull());
    expect(location.hash).toBe('');
  });

  it('opens on load when the hash has view=full, inheriting the global query', async () => {
    history.replaceState(null, '', '/#card=b&view=full');
    mount();
    await waitFor(() => expect(dlg()).toBeTruthy());
    expect(dlg()!.getAttribute('aria-label')).toContain('T-b');
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: 'zed' } });
    expect(dlg()!.querySelector('[data-testid="body"]')!.textContent).toContain('q=zed');
  });

  it('opens and closes on hashchange', async () => {
    mount();
    await screen.findByText('T-a');
    act(() => {
      location.hash = '#card=a&view=full';
    });
    await waitFor(() => expect(dlg()).toBeTruthy());
    act(() => {
      location.hash = '';
    });
    await waitFor(() => expect(dlg()).toBeNull());
  });

  it('unknown fullscreen id toasts and clears the hash', async () => {
    history.replaceState(null, '', '/#card=nope&view=full');
    const { toasts } = mount();
    await waitFor(() => expect(messages(toasts)).toContain('card not found'));
    expect(dlg()).toBeNull();
    expect(location.hash).toBe('');
  });
});

describe('Deep link', () => {
  it.each(['n', 'al', 'a'])('scrolls %s into view, highlights 2 s, clears hash', async (id) => {
    history.replaceState(null, '', `/#card=${id}`);
    const { toasts } = mount();
    await screen.findByText('T-a');
    await waitFor(() => expect(frame(id).className).toContain('card-highlight'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(location.hash).toBe('');
    expect(messages(toasts)).toEqual([]);
    await waitFor(() => expect(frame(id).className).not.toContain('card-highlight'), { timeout: 3000 });
  });

  it('highlight lasts exactly 2000 ms (fake timers)', async () => {
    history.replaceState(null, '', '/#card=a');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await vi.waitFor(() => expect(frame('a')?.className).toContain('card-highlight'));
    act(() => void vi.advanceTimersByTime(1900));
    expect(frame('a').className).toContain('card-highlight');
    act(() => void vi.advanceTimersByTime(150));
    expect(frame('a').className).not.toContain('card-highlight');
  });

  it('hashchange after load triggers it too', async () => {
    mount();
    await screen.findByText('T-a');
    act(() => {
      location.hash = '#card=b';
    });
    await waitFor(() => expect(frame('b').className).toContain('card-highlight'));
    expect(location.hash).toBe('');
  });

  it('Done-tray and hidden targets toast instead', async () => {
    mount();
    await screen.findByText('T-a');
    act(() => {
      location.hash = '#card=d';
    });
    await screen.findByText('T-d is Done');
    act(() => {
      location.hash = '#card=h';
    });
    await screen.findByText('T-h is hidden');
    act(() => {
      location.hash = '#card=ghost';
    });
    await screen.findByText('card not found');
    expect(location.hash).toBe('');
  });
});
