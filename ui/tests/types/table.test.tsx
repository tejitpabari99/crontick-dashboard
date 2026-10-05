import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import '../../src/types/table/index.ts';
import example from '../../../templates/table.example.json';
import type { CardTypeProps } from '../../src/registry/registry.ts';
import type { TableData } from '../../../src/index.js';

const def = getCardType('table')!;
type P = CardTypeProps<TableData>;

function renderTable(data: unknown, over: Partial<P> = {}) {
  const C = def.Component as React.ComponentType<P>;
  return render(
    <C
      card={{ id: 'c1' } as never}
      data={data as TableData}
      mode="grid"
      query=""
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
      {...over}
    />,
  );
}

const big = (n: number) => ({
  columns: ['Name', 'N'],
  rows: Array.from({ length: n }, (_, i) => ({ cells: [`row${i}`, i] })),
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('table type', () => {
  it('registers without alert; searchText covers labels + cells', () => {
    expect(def.allowedModes).toEqual(['grid', 'now', 'fullscreen']);
    expect(def.searchText({ columns: ['A'], rows: [{ cells: ['x'] }] } as never)).toBe('A x');
  });

  it('real table semantics, number/bool/null rendering', () => {
    const { container } = renderTable({
      columns: ['Name', { label: 'Qty', sort: 'number' }, 'Ok'],
      rows: [{ cells: ['a', 5, true] }, { cells: ['b', null, false] }],
    });
    expect(container.querySelectorAll('th[scope="col"]').length).toBe(3);
    const cells = container.querySelectorAll('tbody tr:first-child td');
    expect(cells[1]!.className).toMatch(/num/);
    expect(cells[2]!.textContent).toContain('✓');
    const row2 = container.querySelectorAll('tbody tr:nth-child(2) td');
    expect(row2[1]!.textContent).toBe('–');
    expect(row2[2]!.textContent).toContain('–');
  });

  it('row link: exactly one anchor with name = first two cells', () => {
    renderTable({ columns: ['A', 'B', 'C'], rows: [{ link: 'https://x.test/1', cells: ['one', 'two', 'three'] }] });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('https://x.test/1');
    expect(links[0]!.textContent).toContain('one two');
    expect(links[0]!.textContent).not.toContain('three');
  });

  it('row link + cell link: two anchors, row link first, correct hrefs, cell above overlay', () => {
    const { container } = renderTable(example.data);
    const links = screen.getAllByRole('link');
    const first = container.querySelector('tbody tr')!;
    const inRow = within(first as HTMLElement).getAllByRole('link');
    expect(inRow).toHaveLength(2);
    expect(inRow[0]!.getAttribute('href')).toBe('https://mail.example.com/msg/1001');
    expect(inRow[1]!.getAttribute('href')).toBe('mailto:alice@example.com');
    expect(inRow[0]!.closest('.tbl-rowlink')).not.toBeNull();
    expect(inRow[1]!.closest('.tbl-cell-link')).not.toBeNull();
    expect(links.length).toBe(3);
  });

  it('javascript: cell link and row link are plain text', () => {
    const { container } = renderTable({
      columns: ['A'],
      rows: [{ link: 'javascript:alert(1)', cells: [{ text: 'evil', link: 'javascript:alert(1)' }] }],
    });
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('evil');
  });

  it('inert row without link', () => {
    const { container } = renderTable({ columns: ['A'], rows: [{ cells: ['x'] }] });
    expect(container.querySelector('a')).toBeNull();
  });

  it('500 rows: compact <=50 with +N more opening fullscreen', async () => {
    const { container } = renderTable(big(500));
    expect(container.querySelectorAll('tbody tr').length).toBe(50);
    fireEvent.click(screen.getByRole('button', { name: '+450 more' }));
    expect(window.location.hash).toContain('view=full');
  });

  it('fullscreen pages 200 at a time', () => {
    const { container } = renderTable(big(500), { mode: 'fullscreen' });
    expect(container.querySelectorAll('tbody tr').length).toBe(200);
    fireEvent.click(screen.getByRole('button', { name: 'Show 200 more' }));
    expect(container.querySelectorAll('tbody tr').length).toBe(400);
    expect(screen.getByRole('button', { name: 'Show 100 more' })).toBeTruthy();
  });

  it('sort header cycles asc, desc, default with aria-sort', () => {
    const { container } = renderTable({ columns: ['Name'], rows: [{ cells: ['b'] }, { cells: ['c'] }, { cells: ['a'] }] });
    const order = () => [...container.querySelectorAll('tbody tr td')].map((t) => t.textContent);
    const th = container.querySelector('th')!;
    const btn = within(th).getByRole('button');
    expect(th.getAttribute('aria-sort')).toBeNull();
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(order()).toEqual(['a', 'b', 'c']);
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(order()).toEqual(['c', 'b', 'a']);
    fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBeNull();
    expect(order()).toEqual(['b', 'c', 'a']);
  });

  it('defaultSort applied initially', () => {
    const { container } = renderTable({
      columns: ['N'],
      rows: [{ cells: [2] }, { cells: [3] }, { cells: [1] }],
      defaultSort: { column: 0, dir: 'desc' },
    });
    expect([...container.querySelectorAll('tbody td')].map((t) => t.textContent)).toEqual(['3', '2', '1']);
    expect(container.querySelector('th')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('search box: hidden when searchable:false; compact needs >5 rows; fullscreen always', () => {
    const r1 = renderTable({ ...big(10), searchable: false });
    expect(screen.queryByRole('searchbox')).toBeNull();
    r1.unmount();
    const r2 = renderTable(big(5));
    expect(screen.queryByRole('searchbox')).toBeNull();
    r2.unmount();
    const r3 = renderTable(big(5), { mode: 'fullscreen' });
    expect(screen.getByRole('searchbox')).toBeTruthy();
    r3.unmount();
    renderTable(big(6));
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('own search filters and announces "n of m rows" in aria-live', () => {
    const { container } = renderTable(big(20));
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('20 of 20 rows');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'row1 5' } });
    expect(live.textContent).toBe('1 of 20 rows');
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('global query pre-filters with <mark>; zero match offers Show all', () => {
    const { container, rerender } = renderTable(big(3), { query: 'row1' });
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    expect(container.querySelector('mark')!.textContent).toBe('row1');
    const C = def.Component as React.ComponentType<P>;
    const props = { card: { id: 'c1' } as never, data: big(3) as TableData, mode: 'grid' as const, checked: new Set<string>(), pending: new Set<string>(), onItemAction: async () => {} };
    rerender(<C {...props} query="zzz" />);
    expect(screen.getByText(/No rows match/).textContent).toContain('zzz');
    expect(container.querySelectorAll('tbody tr').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('empty rows shows "No rows"', () => {
    renderTable({ columns: ['A'], rows: [] });
    expect(screen.getByText('No rows')).toBeTruthy();
  });

  it('sticky header class and compact clamp title / fullscreen wrap', () => {
    const { container } = renderTable({ columns: ['A'], rows: [{ cells: ['long text'] }] });
    expect(container.querySelector('table')!.className).toMatch(/tbl/);
    expect(container.querySelector('td .clamp-1')!.getAttribute('title')).toBe('long text');
    cleanup();
    const full = renderTable({ columns: ['A'], rows: [{ cells: ['long text'] }] }, { mode: 'fullscreen' });
    expect(full.container.querySelector('td .clamp-1')).toBeNull();
  });

  it('axe: email example has no critical violations', async () => {
    const { container } = renderTable(example.data);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([]);
  });

  describe('fullscreen filter', () => {
    const data = {
      columns: ['Name', 'Status', 'Env', 'Id'],
      rows: [
        { cells: ['a', 'up', 'prod', 1] },
        { cells: ['b', 'down', 'prod', 2] },
        { cells: ['c', 'up', 'dev', 3] },
        { cells: ['d', null, 'dev', 4] },
        { cells: ['e', 'up', 'prod', 5] },
        { cells: ['f', 'up', 'prod', 6] },
      ],
    };
    const bodyRows = (c: HTMLElement) => c.querySelectorAll('tbody tr').length;

    it('absent in compact/grid mode', () => {
      renderTable(data);
      expect(screen.queryByRole('button', { name: /^Filter / })).toBeNull();
    });

    it('only eligible columns (2-20 distinct) get a filter button', () => {
      renderTable(
        {
          columns: ['Name', 'Status', 'Const'],
          rows: Array.from({ length: 21 }, (_, i) => ({ cells: [`n${i}`, i % 2 ? 'up' : 'down', 'x'] })),
        },
        { mode: 'fullscreen' },
      );
      expect(screen.getByRole('button', { name: 'Filter Status' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Filter Name' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Filter Const' })).toBeNull();
    });

    it('OR within column, AND across columns, count live region updates, empty shows dash', () => {
      const { container } = renderTable(data, { mode: 'fullscreen' });
      fireEvent.click(screen.getByRole('button', { name: 'Filter Status' }));
      expect(screen.getByRole('checkbox', { name: '–' })).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox', { name: 'up' }));
      expect(bodyRows(container)).toBe(4);
      fireEvent.click(screen.getByRole('checkbox', { name: 'down' }));
      expect(bodyRows(container)).toBe(5);
      expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('5 of 6 rows');
      fireEvent.click(screen.getByRole('button', { name: 'Filter Env' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'dev' }));
      expect(bodyRows(container)).toBe(1);
      expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('1 of 6 rows');
    });

    it('chips show active filters and remove restores rows', () => {
      const { container } = renderTable(data, { mode: 'fullscreen' });
      fireEvent.click(screen.getByRole('button', { name: 'Filter Env' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'dev' }));
      expect(bodyRows(container)).toBe(2);
      fireEvent.click(screen.getByRole('button', { name: 'Remove filter Env: dev' }));
      expect(bodyRows(container)).toBe(6);
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();
    });

    it('drops filters for columns that stop being filterable after a data refresh', () => {
      const mk = (envs: string[]) => ({
        columns: ['Name', 'Env'],
        rows: envs.map((e, i) => ({ cells: [`n${i}`, e] })),
      });
      const props = { card: { id: 'c1' } as never, mode: 'fullscreen' as const, query: '', checked: new Set<string>(), pending: new Set<string>(), onItemAction: async () => {} };
      const C = def.Component as React.ComponentType<P>;
      const { container, rerender } = render(<C {...props} data={mk(['dev', 'prod', 'prod']) as TableData} />);
      fireEvent.click(screen.getByRole('button', { name: 'Filter Env' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'dev' }));
      expect(bodyRows(container)).toBe(1);
      rerender(<C {...props} data={mk(['prod', 'prod', 'prod']) as TableData} />);
      expect(screen.queryByText('No rows match the filters')).toBeNull();
      expect(bodyRows(container)).toBe(3);
    });

    it('drops filter values that are no longer present', () => {
      const mk = (envs: string[]) => ({ columns: ['Name', 'Env'], rows: envs.map((e, i) => ({ cells: [`n${i}`, e] })) });
      const props = { card: { id: 'c1' } as never, mode: 'fullscreen' as const, query: '', checked: new Set<string>(), pending: new Set<string>(), onItemAction: async () => {} };
      const C = def.Component as React.ComponentType<P>;
      const { container, rerender } = render(<C {...props} data={mk(['dev', 'prod', 'qa']) as TableData} />);
      fireEvent.click(screen.getByRole('button', { name: 'Filter Env' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'dev' }));
      rerender(<C {...props} data={mk(['prod', 'qa', 'qa']) as TableData} />);
      expect(bodyRows(container)).toBe(3);
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();
    });

    it('keyboard: button has aria-expanded and Escape closes the popover', () => {
      renderTable(data, { mode: 'fullscreen' });
      const btn = screen.getByRole('button', { name: 'Filter Env' });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      fireEvent.keyDown(screen.getByRole('group', { name: 'Filter Env values' }), { key: 'Escape' });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('group', { name: 'Filter Env values' })).toBeNull();
    });

    it('axe: fullscreen with open popover and chips', async () => {
      const { container } = renderTable(data, { mode: 'fullscreen' });
      fireEvent.click(screen.getByRole('button', { name: 'Filter Env' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'dev' }));
      const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(res.violations.map((v) => v.id)).toEqual([]);
    });
  });
});
