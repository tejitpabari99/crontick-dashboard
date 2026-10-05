import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutItem, ViewCard } from '../src/api/types.ts';
import { CardFrame, resetExpanded } from '../src/frame/CardFrame.tsx';
import { registerCardType } from '../src/registry/registry.ts';
import { Grid } from '../src/zones/Grid.tsx';

type RglProps = {
  layout: LayoutItem[];
  gridConfig: Record<string, unknown>;
  dragConfig: Record<string, unknown>;
  resizeConfig: Record<string, unknown>;
  onLayoutChange?: unknown;
  onDragStart(): void;
  onDragStop(l: LayoutItem[]): void;
  onResizeStart(): void;
  onResizeStop(l: LayoutItem[]): void;
};
const captured: { props: RglProps | null } = { props: null };

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({ width: 1200, containerRef: { current: null }, mounted: true }),
  verticalCompactor: { type: 'vertical' },
  GridLayout: (props: RglProps & { children: unknown }) => {
    captured.props = props;
    return <div data-testid="rgl">{props.children as never}</div>;
  },
}));

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-grid', { Component: () => <p>BODY</p>, searchText: () => '' });

function card(id: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    kind: 'panel',
    type: 'zz-grid',
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

const L = (i: string, x: number, y: number, w = 3, h = 7): LayoutItem => ({ i, x, y, w, h });

function setup(cards: ViewCard[], layout: LayoutItem[]) {
  const putLayout = vi.fn<(l: LayoutItem[]) => Promise<void>>(async () => {});
  const putLayoutKeepalive = vi.fn();
  const mk = (cs: ViewCard[], lay: LayoutItem[]) => (
    <Grid
      cards={cs}
      layout={lay}
      putLayout={putLayout}
      putLayoutKeepalive={putLayoutKeepalive}
      renderCard={(c) => (
        <CardFrame
          card={c}
          mode="grid"
          query=""
          checked={new Set()}
          pending={new Set()}
          nowPriorityThreshold={8}
          onItemAction={async () => {}}
          onDone={() => {}}
          onHide={() => {}}
          onFullscreen={() => {}}
        />
      )}
    />
  );
  const r = render(mk(cards, layout));
  return { putLayout, putLayoutKeepalive, rerender: (cs: ViewCard[], lay: LayoutItem[]) => r.rerender(mk(cs, lay)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetExpanded();
  captured.props = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Grid', () => {
  it('configures RGL: 12 cols, rowHeight 28, margin 10, title-bar handle, se resize, no onLayoutChange', () => {
    setup([card('a')], [L('a', 0, 0)]);
    const p = captured.props!;
    expect(p.gridConfig).toMatchObject({ cols: 12, rowHeight: 28, margin: [10, 10] });
    expect(p.dragConfig.handle).toBe('.drag-handle');
    expect(p.resizeConfig.handles).toEqual(['se']);
    expect(p.onLayoutChange).toBeUndefined();
    expect(document.querySelector('.drag-handle')).not.toBeNull();
  });

  it('one PUT per burst of drag stops, debounced 800 ms, full array incl. absent entries', async () => {
    const { putLayout } = setup([card('a'), card('b')], [L('a', 0, 0), L('b', 3, 0), L('now1', 6, 0)]);
    act(() => captured.props!.onDragStart());
    act(() => captured.props!.onDragStop([L('a', 0, 2), L('b', 3, 0)]));
    await act(async () => void vi.advanceTimersByTime(500));
    act(() => captured.props!.onResizeStart());
    act(() => captured.props!.onResizeStop([L('a', 0, 2), L('b', 3, 0, 4, 9)]));
    await act(async () => void vi.advanceTimersByTime(799));
    expect(putLayout).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(2));
    expect(putLayout).toHaveBeenCalledTimes(1);
    expect(putLayout.mock.calls[0]![0]).toEqual([L('a', 0, 2), L('b', 3, 0, 4, 9), L('now1', 6, 0)]);
  });

  it('no PUT from compaction-only layout changes or mount', async () => {
    const { putLayout } = setup([card('a'), card('b')], [L('a', 0, 0), L('b', 3, 5)]);
    // RGL has no onLayoutChange wired: nothing can fire; and nothing is scheduled by itself
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(putLayout).not.toHaveBeenCalled();
  });

  it('auto-places unplaced cards then persists once', async () => {
    const { putLayout } = setup([card('a'), card('b', { size: 'S' })], [L('a', 0, 0)]);
    expect(captured.props!.layout.map((l) => l.i)).toEqual(['a', 'b']);
    await act(async () => void vi.advanceTimersByTime(801));
    expect(putLayout).toHaveBeenCalledTimes(1);
    expect(putLayout.mock.calls[0]![0]).toEqual([L('a', 0, 0), { i: 'b', x: 3, y: 0, w: 3, h: 4 }]);
  });

  it('flushes a pending write on pagehide via keepalive', async () => {
    const { putLayout, putLayoutKeepalive } = setup([card('a')], [L('a', 0, 0)]);
    act(() => captured.props!.onDragStart());
    act(() => captured.props!.onDragStop([L('a', 4, 0)]));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(putLayoutKeepalive).toHaveBeenCalledWith([L('a', 4, 0)]);
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(putLayout).not.toHaveBeenCalled();
  });

  it('ignores incoming snapshot layout during an active drag', () => {
    const { rerender } = setup([card('a')], [L('a', 0, 0)]);
    act(() => captured.props!.onDragStart());
    rerender([card('a')], [L('a', 9, 9)]);
    expect(captured.props!.layout[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('a Now card absent from the grid returns to its saved slot', async () => {
    const saved = [L('a', 0, 0), L('n', 3, 0), L('b', 6, 0)];
    const { rerender, putLayout } = setup([card('a'), card('b')], saved);
    expect(captured.props!.layout.map((l) => l.i)).toEqual(['a', 'b']);
    // a new card must not take n's reserved slot
    rerender([card('a'), card('b'), card('c')], saved);
    await act(async () => void vi.advanceTimersByTime(801));
    const placed = putLayout.mock.calls[0]![0].find((l) => l.i === 'c')!;
    expect(placed).toMatchObject({ x: 9, y: 0 });
    // n's window closes: renders at saved slot
    rerender([card('a'), card('n'), card('b')], saved);
    expect(captured.props!.layout.find((l) => l.i === 'n')).toEqual(L('n', 3, 0));
  });

  it('priority<=1 collapsed card renders as chip at h=1 (not persisted); expand restores stored h', async () => {
    const { putLayout } = setup([card('a', { collapsed: true, priority: 1 })], [L('a', 0, 0, 3, 7)]);
    expect(screen.queryByText('BODY')).toBeNull();
    expect(document.querySelector('.card-frame--chip')).not.toBeNull();
    expect(captured.props!.layout[0]).toMatchObject({ h: 1 });
    act(() => captured.props!.onDragStop([L('a', 3, 0, 3, 1)]));
    await act(async () => void vi.advanceTimersByTime(801));
    expect(putLayout.mock.calls[0]![0]).toEqual([L('a', 3, 0, 3, 7)]);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(captured.props!.layout[0]).toMatchObject({ h: 7 });
    expect(screen.getByText('BODY')).toBeTruthy();
  });
});
