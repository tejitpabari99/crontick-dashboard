import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import '../../src/types/kpi/index.ts';
import example from '../../../templates/kpi/data.json';
import type { CardTypeProps } from '../../src/registry/registry.ts';
import type { KpiData } from '../../../src/index.js';

const def = getCardType('kpi')!;
type P = CardTypeProps<KpiData>;
const C = def.Component as React.ComponentType<P>;

function el(data: unknown, over: Partial<P> = {}) {
  return (
    <C
      card={{ id: 'c1' } as never}
      data={data as KpiData}
      mode="column"
      query=""
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
      {...over}
    />
  );
}
const renderKpi = (data: unknown, over: Partial<P> = {}) => render(el(data, over));
const n = (k: number) => ({ items: Array.from({ length: k }, (_, i) => ({ label: `m${i}`, value: i + 1 })) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('kpi type', () => {
  it('searchText covers label, value, unit, state word', () => {
    expect(def.searchText({ items: [{ label: 'Up', value: 5, unit: '%', state: 'fail' }, { value: 'x' }] } as never)).toBe('Up 5 % Failed x');
  });

  it('1 item: single large tile; 3 items: 3 tiles no more', () => {
    const { container, unmount } = renderKpi(n(1));
    expect(container.querySelectorAll('li').length).toBe(1);
    expect(container.querySelector('.kpi-root--single')).not.toBeNull();
    unmount();
    const r = renderKpi(n(3));
    expect(r.container.querySelectorAll('li').length).toBe(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('6 items: 4 tiles + "+2 more" button opening fullscreen; fullscreen shows all', () => {
    const { container, unmount } = renderKpi(n(6));
    expect(container.querySelectorAll('li').length).toBe(4);
    screen.getByRole('button', { name: '+2 more' }).click();
    expect(window.location.hash).toContain('view=full');
    unmount();
    const r = renderKpi(n(6), { mode: 'fullscreen' });
    expect(r.container.querySelectorAll('li').length).toBe(6);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('flat-form (normalized) equals items form', () => {
    const a = renderKpi({ items: [{ label: 'L', value: 7, unit: 'ms' }] }).container.innerHTML;
    cleanup();
    const b = renderKpi({ items: [{ label: 'L', value: 7, unit: 'ms' }] }).container.innerHTML;
    expect(a).toBe(b);
  });

  it('formats numbers, string verbatim, missing "–"', () => {
    const { container } = renderKpi({ items: [{ label: 'a', value: 12345 }, { label: 'b', value: 'Deployed' }, { label: 'c' }] });
    const vals = [...container.querySelectorAll('.kpi-value')].map((v) => v.textContent);
    expect(vals).toEqual([new Intl.NumberFormat().format(12345), 'Deployed', '–']);
    expect(container.querySelectorAll('.kpi-value')[1]?.className).toContain('clamp-2');
  });

  it('delta -3 good down is positive; up when good down is negative', () => {
    const { container } = renderKpi({
      items: [
        { label: 'a', value: 1, trend: { delta: -3, good: 'down' } },
        { label: 'b', value: 1, trend: { delta: 3, good: 'down' } },
        { label: 'c', value: 1, trend: { delta: 0 } },
      ],
    });
    const t = container.querySelectorAll('.kpi-trend');
    expect(t[0]?.className).toContain('--positive');
    expect(t[0]?.textContent).toContain('▼');
    expect(t[1]?.className).toContain('--negative');
    expect(t[2]?.className).toContain('--flat');
  });

  it('state shows icon plus text label with aria-label', () => {
    renderKpi({ items: [{ label: 'a', value: 1, state: 'fail' }] });
    const s = screen.getByLabelText('State: Failed');
    expect(s.textContent).toContain('❌');
    expect(s.textContent).toContain('Failed');
  });

  it('tile link uses CardLink', () => {
    const { container } = renderKpi({ items: [{ label: 'a', value: 1, link: 'https://x.test/a' }] });
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://x.test/a');
  });

  describe('fade', () => {
    const mm = (matches: boolean) => vi.stubGlobal('matchMedia', () => ({ matches }));
    it('fades on value change, not on first render', () => {
      mm(false);
      const r = renderKpi(n(1));
      expect(r.container.querySelector('[data-fade]')).toBeNull();
      r.rerender(el({ items: [{ label: 'm0', value: 99 }] }));
      expect(r.container.querySelector('[data-fade="true"]')).not.toBeNull();
    });
    it('no fade under reduced motion', () => {
      mm(true);
      const r = renderKpi(n(1));
      r.rerender(el({ items: [{ label: 'm0', value: 99 }] }));
      expect(r.container.querySelector('[data-fade]')).toBeNull();
    });
  });

  it('renders 01 example with no axe violations (all modes)', async () => {
    for (const mode of ['column', 'fullscreen'] as const) {
      const { container, unmount } = renderKpi(example.data, { mode });
      const res = await axe.run(container);
      expect(res.violations).toEqual([]);
      unmount();
    }
  });
});
