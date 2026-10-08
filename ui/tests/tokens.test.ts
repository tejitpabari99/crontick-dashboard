import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLUMNS_BREAKPOINT_PX } from './helpers/breakpoint.ts';

const themeDir = join(import.meta.dirname, '../src/theme');
const tokensCss = readFileSync(join(themeDir, 'tokens.css'), 'utf8');
const columnsPath = join(themeDir, 'columns.css');

const LAYOUT_TOKENS: Record<string, string> = {
  '--col-side': '300px',
  '--col-gap': '16px',
  '--page-pad': '16px',
  '--h-S': '180px',
  '--h-M': '360px',
  '--h-L': '600px',
  '--chip-h': '32px',
};

describe('layout tokens', () => {
  for (const [name, value] of Object.entries(LAYOUT_TOKENS)) {
    it(`${name} is ${value}`, () => {
      const m = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(m?.[1]?.trim()).toBe(value);
    });
  }

  it('breakpoint constant is 1200', () => {
    expect(COLUMNS_BREAKPOINT_PX).toBe(1200);
  });

  it.skipIf(!existsSync(columnsPath))('columns.css uses the same breakpoint literal', () => {
    const css = readFileSync(columnsPath, 'utf8');
    expect(css).toContain(`max-width: ${COLUMNS_BREAKPOINT_PX}px`);
  });
});
