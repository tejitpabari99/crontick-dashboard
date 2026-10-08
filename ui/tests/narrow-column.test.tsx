import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getCardType } from '../src/registry/registry.ts';
import '../src/types/kpi/index.ts';
import '../src/types/media/index.ts';
import type { CardTypeProps } from '../src/registry/registry.ts';

const SIDE = 300; // --col-side
const types = join(import.meta.dirname, '../src/types');
const css = (n: string) => readFileSync(join(types, n, `${n}.css`), 'utf8');

function mount(type: string, data: unknown) {
  const C = getCardType(type)!.Component as React.ComponentType<CardTypeProps<never>>;
  return render(
    <div style={{ width: `${SIDE}px` }} data-testid="col">
      <C card={{ id: 'c' } as never} data={data as never} mode="column" query="" checked={new Set()} pending={new Set()} onItemAction={async () => {}} />
    </div>,
  );
}
afterEach(cleanup);

describe('kpi and media at the 300px side-column width', () => {
  it('kpi tiles render inside a 300px column; tile minimum fits two across', () => {
    const { container } = mount('kpi', { items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }] });
    expect(container.querySelectorAll('.kpi-tile')).toHaveLength(3);
    const min = Number(/\.kpi-grid\s*\{[^}]*minmax\((\d+)px/.exec(css('kpi'))![1]);
    expect(min * 2 + 8).toBeLessThanOrEqual(SIDE);
  });

  it('media figures render inside a 300px column; grid is not wider than the column', () => {
    const { container } = mount('media', { items: [{ src: 'https://e.com/1.png', alt: 'a' }, { src: 'https://e.com/2.png', alt: 'b' }] });
    expect(container.querySelectorAll('.media-figure')).toHaveLength(2);
    // compact media/kpi bodies carry no fixed pixel min-width/width that could exceed the column
    for (const n of ['kpi', 'media']) {
      const widths = [...css(n).matchAll(/(?<![\w(-])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
      for (const w of widths) expect(w).toBeLessThanOrEqual(SIDE);
    }
    expect(css('media')).toMatch(/minmax\(0,\s*1fr\)/);
  });
});
