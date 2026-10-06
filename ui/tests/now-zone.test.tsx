import { POLL_DEFAULT_MS } from '../../src/constants/poll.ts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutItem, ViewCard } from '../src/api/types.ts';
import { registerCardType } from '../src/registry/registry.ts';
import { NowZone } from '../src/zones/NowZone.tsx';
import { DoneTray } from '../src/zones/DoneTray.tsx';
import { Grid } from '../src/zones/Grid.tsx';
import { createClient } from '../src/api/client.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createToastStore } from '../src/api/toasts.ts';

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
  verticalCompactor: {},
  GridLayout: (props: { children: unknown }) => <div>{props.children as never}</div>,
}));

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-now', { Component: (p: { mode: string }) => <p>BODY-{p.mode}</p>, searchText: () => '' });

function card(id: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    kind: 'panel',
    type: 'zz-now',
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

const common = {
  query: '',
  checked: () => new Set<string>() as ReadonlySet<string>,
  pending: () => new Set<string>() as ReadonlySet<string>,
  nowPriorityThreshold: 5,
  onItemAction: async () => {},
  onDone: () => {},
  onHide: () => {},
  onFullscreen: () => {},
  onTick: () => {},
};

afterEach(cleanup);

describe('NowZone', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<NowZone alerts={[]} panels={[]} {...common} />);
    expect(container.firstChild).toBeNull();
  });

  it('alerts expose only Tick, in order, at mode alert, in a polite region', () => {
    const onTick = vi.fn();
    render(
      <NowZone
        alerts={[card('a2', { kind: 'alert', priority: 9 }), card('a1', { kind: 'alert' })]}
        panels={[]}
        {...common}
        onTick={onTick}
      />
    );
    const region = screen.getByRole('region', { name: /alerts/i });
    expect(region.getAttribute('aria-live')).toBe('polite');
    const rows = within(region).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-card-id'))).toEqual(['a2', 'a1']);
    expect(screen.getAllByText('BODY-alert')).toHaveLength(2);
    const btns = within(rows[0]!).getAllByRole('button');
    expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['Tick']);
    fireEvent.click(btns[0]!);
    expect(onTick).toHaveBeenCalledWith('a2');
    expect(screen.queryByLabelText('Hide')).toBeNull();
    expect(screen.queryByLabelText('Done')).toBeNull();
    expect(screen.queryByLabelText('Collapse')).toBeNull();
  });

  it('promoted panels render in now mode via the frame, in order', () => {
    render(<NowZone alerts={[]} panels={[card('p2'), card('p1')]} {...common} />);
    const els = document.querySelectorAll('[data-card-id]');
    expect([...els].map((e) => e.getAttribute('data-card-id'))).toEqual(['p2', 'p1']);
    expect(screen.getAllByText('BODY-now')).toHaveLength(2);
  });
});

describe('Grid vs Now', () => {
  it('a panel in Now is absent from the grid', () => {
    const grid = [card('g1')];
    render(
      <>
        <NowZone alerts={[]} panels={[card('p1')]} {...common} />
        <Grid
          cards={grid}
          layout={[{ i: 'g1', x: 0, y: 0, w: 3, h: 7 } as LayoutItem]}
          putLayout={async () => {}}
          putLayoutKeepalive={() => {}}
          renderCard={(c) => <div data-grid-card={c.id} />}
        />
      </>
    );
    expect(document.querySelectorAll('[data-grid-card="p1"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-grid-card="g1"]')).toHaveLength(1);
  });
});

describe('DoneTray', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<DoneTray cards={[]} onReopen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('chip click reopens via DELETE /api/cards/:id/done', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const snap = {
      serverTime: 't',
      rev: 'r',
      warnings: [],
      config: { pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: 5 },
      zones: { alerts: [], now: [], grid: [], tray: ['x'], hidden: [] },
      cards: { x: card('x') },
      layout: [],
    };
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url === '/api/snapshot')
        return new Response(JSON.stringify(snap), { status: 200, headers: { ETag: String(Math.random()) } });
      return new Response('{}', { status: 200 });
    });
    const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
    const m = createMutations({ store, toasts: createToastStore(), fetch: fetchFn });
    render(<DoneTray cards={[card('x')]} onReopen={(id) => void m.undone(id)} />);
    const chip = screen.getByRole('button', { name: /T-x/ });
    expect(chip.textContent).toMatch(/ago|just now/);
    fireEvent.click(chip);
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/cards/x/done')).toBe(true)
    );
  });
});
