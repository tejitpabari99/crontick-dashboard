import axe from 'axe-core';
import { cleanup, render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import type { CardTypeProps, Mode } from '../../src/registry/registry.ts';
import '../../src/types/index.ts';

const dir = join(import.meta.dirname, '../../../templates');
const examples = readdirSync(dir)
  .filter((f) => f.endsWith('.example.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; type: string; data: unknown });

afterEach(cleanup);

function mount(type: string, data: unknown, mode: Mode, query = '') {
  const C = getCardType(type)!.Component as React.ComponentType<CardTypeProps<never>>;
  return render(
    <C
      card={{ id: 'c1' } as never}
      data={data as never}
      mode={mode}
      query={query}
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
    />,
  );
}

describe('templates/*.example.json fixtures', () => {
  it('covers all five types', () => {
    expect(examples.map((e) => e.type).sort()).toEqual(['kpi', 'list', 'markdown', 'media', 'table']);
  });

  describe.each(examples)('$type', ({ type, data }) => {
    it('renders with zero console errors and no axe violations', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const modes = (getCardType(type)!.allowedModes ?? ['grid', 'now', 'alert', 'fullscreen']) as Mode[];
      for (const mode of modes) {
        const { container, unmount } = mount(type, data, mode);
        const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
        expect(res.violations.map((v) => v.id), `${type}/${mode}`).toEqual([]);
        unmount();
      }
      expect(err).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('searchText never throws on empty or extra-key data', () => {
      const def = getCardType(type)!;
      for (const d of [{}, { extra: 1 }, { items: [], rows: [], columns: [], text: '' }]) {
        expect(() => def.searchText(d as never)).not.toThrow();
        expect(typeof def.searchText(d as never)).toBe('string');
      }
    });
  });
});
