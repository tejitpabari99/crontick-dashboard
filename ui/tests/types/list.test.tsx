import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import '../../src/types/list/index.ts';
import example from '../../../templates/list.example.json';
import type { CardTypeProps } from '../../src/registry/registry.ts';
import { PAGE } from '../../src/constants/types.ts';
import type { ListData } from '../../../src/index.js';

const def = getCardType('list')!;
type P = CardTypeProps<ListData>;

function renderList(data: unknown, over: Partial<P> = {}) {
  const C = def.Component as React.ComponentType<P>;
  return render(
    <C
      card={{ id: 'c1' } as never}
      data={data as ListData}
      mode="column"
      query=""
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
      {...over}
    />,
  );
}

const many = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: `item${i}` })) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.location.hash = '';
});

describe('list type', () => {
  it('registers with searchText = text + subtitle', () => {
    expect(def.allowedModes).toBeUndefined();
    expect(def.searchText({ items: [{ text: 'a', subtitle: 'b' }, { text: 'c' }] } as never)).toBe('a b c');
  });

  it('renders ul, link as anchor, links[] as separate anchors beside it', () => {
    const { container } = renderList({
      items: [{ text: 'Mail', link: 'https://x.test/m', links: [{ text: 'Unsub', link: 'https://x.test/u' }] }],
    });
    expect(container.querySelector('ul')).not.toBeNull();
    const a = container.querySelectorAll('a');
    expect(a.length).toBe(2);
    expect(a[0]!.contains(a[1]!)).toBe(false);
    expect(a[0]!.getAttribute('href')).toBe('https://x.test/m');
    expect(a[1]!.getAttribute('href')).toBe('https://x.test/u');
  });

  it('due labels: overdue negative with word, today, tomorrow; checked overdue unstyled', () => {
    renderList({
      items: [
        { id: 'a', text: 'late', due: '2026-10-04' },
        { id: 'b', text: 'now', due: '2026-10-05' },
        { id: 'c', text: 'soon', due: '2026-10-06' },
        { id: 'd', text: 'doneLate', due: '2026-10-04', checked: true },
      ],
    });
    const all = screen.getAllByText('Overdue 1d');
    expect(all[0]!.className).toMatch(/negative/);
    expect(screen.getByText('Today').className).not.toMatch(/negative/);
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(all.length).toBe(2);
    expect(all[1]!.className).not.toMatch(/negative/);
  });

  it('clamps text/subtitle with title', () => {
    renderList({ items: [{ text: 'long text', subtitle: 'sub' }] });
    const t = screen.getByText('long text');
    expect(t.className).toMatch(/clamp-2/);
    expect(t.getAttribute('title')).toBe('long text');
    expect(screen.getByText('sub').getAttribute('title')).toBe('sub');
  });

  it('checked from item.checked or set; no reorder; header k of n', () => {
    const { container } = renderList(
      { items: [{ id: 'a', text: 'A', action: 'complete' }, { id: 'b', text: 'B', checked: true, action: 'complete' }, { id: 'c', text: 'C' }] },
      { checked: new Set(['a']) },
    );
    expect(Array.from(container.querySelectorAll('li')).map((l) => l.textContent?.[0])).toEqual(['A', 'B', 'C']);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes.length).toBe(2);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(true);
    expect(screen.getByText('2 of 3 done')).toBeTruthy();
  });

  it('empty text and fallback', () => {
    renderList({ items: [], emptyText: 'Nothing due' });
    expect(screen.getByText('Nothing due')).toBeTruthy();
    cleanup();
    renderList({ items: [] });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('compact caps at 100 with +N more button opening fullscreen', () => {
    const { container } = renderList(many(130));
    expect(container.querySelectorAll('li').length).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: '+30 more' }));
    expect(window.location.hash).toContain('card=c1');
    expect(window.location.hash).toContain('view=full');
  });

  it('fullscreen shows PAGE, Show more pages, Hide done toggles', () => {
    const { container } = renderList(many(PAGE + 50), { mode: 'fullscreen' });
    expect(container.querySelectorAll('li').length).toBe(PAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(container.querySelectorAll('li').length).toBe(PAGE + 50);
    cleanup();
    const r = renderList({ items: [{ id: 'a', text: 'A', checked: true }, { id: 'b', text: 'B' }] }, { mode: 'fullscreen' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide done' }));
    expect(r.container.querySelectorAll('li').length).toBe(1);
  });

  it('query pre-filters with <mark>; zero match offers Show all', () => {
    const { container } = renderList(many(3), { query: 'item1' });
    expect(container.querySelectorAll('li').length).toBe(1);
    expect(container.querySelector('mark')!.textContent).toBe('item1');
    cleanup();
    renderList(many(3), { query: 'zzz' });
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(document.querySelectorAll('li').length).toBe(3);
  });

  it('renders 01 example with no axe violations', async () => {
    const { container } = renderList(example.data);
    expect(container.querySelectorAll('li').length).toBe(3);
    const res = await axe.run(container);
    expect(res.violations).toEqual([]);
  });

  describe('item actions', () => {
    const acts = (type: string, extra: object = {}) => ({
      items: [{ id: 'a', text: 'Alpha', action: { type }, ...extra }],
    });
    const box = () => screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement;

    it('no checkbox without action', () => {
      renderList({ items: [{ id: 'a', text: 'Alpha' }] });
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('initial item.checked and set-driven checked', () => {
      const { unmount } = renderList(acts('complete', { checked: true }));
      expect(box().checked).toBe(true);
      unmount();
      renderList(acts('complete'), { checked: new Set(['a']) });
      expect(box().checked).toBe(true);
    });

    it('click calls onItemAction(id, true); complete checked unticks with false', () => {
      const fn = vi.fn(async () => {});
      const { unmount } = renderList(acts('complete'), { onItemAction: fn });
      fireEvent.click(box());
      expect(fn).toHaveBeenCalledWith('a', true);
      unmount();
      const fn2 = vi.fn(async () => {});
      renderList(acts('complete'), { checked: new Set(['a']), onItemAction: fn2 });
      expect(box().disabled).toBe(false);
      fireEvent.click(box());
      expect(fn2).toHaveBeenCalledWith('a', false);
    });

    it('dismiss checked is disabled and never fires', () => {
      const fn = vi.fn(async () => {});
      renderList(acts('dismiss'), { checked: new Set(['a']), onItemAction: fn });
      expect(box().disabled).toBe(true);
      fireEvent.click(box());
      expect(fn).not.toHaveBeenCalled();
    });

    it('pending: disabled + aria-busy, spinner only after 150 ms', () => {
      vi.useFakeTimers();
      renderList(acts('complete'), { pending: new Set(['a']) });
      expect(box().disabled).toBe(true);
      expect(box().getAttribute('aria-busy')).toBe('true');
      expect(document.querySelector('.lst-spin')).toBeNull();
      act(() => void vi.advanceTimersByTime(150));
      expect(document.querySelector('.lst-spin')).not.toBeNull();
    });

    it('not pending: no aria-busy', () => {
      renderList(acts('complete'));
      expect(box().getAttribute('aria-busy')).toBeNull();
    });

    it('resolve: no failed text', async () => {
      renderList(acts('complete'), { onItemAction: async () => {} });
      await act(async () => void fireEvent.click(box()));
      expect(screen.queryByText(/Couldn’t save/)).toBeNull();
    });

    it('reject shows failed text; clears after 8 s', async () => {
      vi.useFakeTimers();
      renderList(acts('complete'), { onItemAction: () => Promise.reject(new Error('x')) });
      await act(async () => void fireEvent.click(box()));
      expect(screen.getByText('Couldn’t save — retry')).toBeTruthy();
      act(() => void vi.advanceTimersByTime(7999));
      expect(screen.queryByText('Couldn’t save — retry')).not.toBeNull();
      act(() => void vi.advanceTimersByTime(2));
      expect(screen.queryByText('Couldn’t save — retry')).toBeNull();
    });

    it('failed clears on next click', async () => {
      let fail = true;
      const fn = vi.fn(() => (fail ? Promise.reject(new Error('x')) : Promise.resolve()));
      renderList(acts('complete'), { onItemAction: fn });
      await act(async () => void fireEvent.click(box()));
      expect(screen.queryByText('Couldn’t save — retry')).not.toBeNull();
      fail = false;
      await act(async () => void fireEvent.click(box()));
      expect(screen.queryByText('Couldn’t save — retry')).toBeNull();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
