import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { contrastRatio, derive, PRESETS, type Hsl } from './helpers/theme-derive.ts';
import { applyTheme, cycleTheme, nextChoice, readChoice, resolveTheme } from '../src/lib/theme.ts';
import { THEME_KEY } from '../src/constants/storage.ts';

const dir = import.meta.dirname;
const themesCss = readFileSync(join(dir, '../src/theme/themes.css'), 'utf8');
const indexHtml = readFileSync(join(dir, '../index.html'), 'utf8');

function block(css: string, selector: RegExp): string {
  const m = css.match(new RegExp(selector.source + String.raw`[^{]*\{([^}]*)\}`));
  if (!m) throw new Error(`no block for ${selector}`);
  return m[1] ?? '';
}
function triple(body: string, name: string): Hsl {
  const get = (c: string): number => Number(body.match(new RegExp(`--${name}-${c}:\\s*([\\d.]+)`))?.[1]);
  return [get('h'), get('s'), get('l')];
}

describe('theme presets', () => {
  const cssBlocks = {
    dark: block(themesCss, /:root,\s*:root\[data-theme='dark'\]/),
    light: block(themesCss, /:root\[data-theme='light'\]/),
  };

  for (const name of ['dark', 'light'] as const) {
    it(`${name}: themes.css matches derive.ts presets`, () => {
      const p = PRESETS[name];
      const b = cssBlocks[name];
      expect(triple(b, 'bg')).toEqual(p.bg);
      expect(triple(b, 'primary')).toEqual(p.primary);
      expect(triple(b, 'positive')).toEqual(p.positive);
      expect(triple(b, 'negative')).toEqual(p.negative);
      expect(Number(b.match(/--contrast:\s*([\d.]+)/)?.[1])).toBe(p.contrast);
      expect(Number(b.match(/--dir:\s*(-?\d+)/)?.[1])).toBe(p.dir);
    });

    it(`${name}: text, muted and primary-on-bg pass WCAG AA (4.5:1)`, () => {
      const d = derive(PRESETS[name]);
      expect(contrastRatio(d.text, d.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(d.textMuted, d.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(d.primary, d.bg)).toBeGreaterThanOrEqual(4.5);
      // text must also read on raised surfaces
      expect(contrastRatio(d.textMuted, d.surface2)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('surfaces move away from bg in the right direction', () => {
    expect(derive(PRESETS.dark).surface1[2]).toBeGreaterThan(PRESETS.dark.bg[2]);
    expect(derive(PRESETS.light).surface1[2]).toBeLessThan(PRESETS.light.bg[2]);
  });
});

describe('theme toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('cycles system -> light -> dark -> system', () => {
    expect(nextChoice('system')).toBe('light');
    expect(nextChoice('light')).toBe('dark');
    expect(nextChoice('dark')).toBe('system');
  });

  it('persists choice and sets data-theme', () => {
    expect(readChoice()).toBe('system');
    expect(cycleTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(cycleTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readChoice()).toBe('dark');
  });

  it('system resolves via prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(applyTheme('light')).toBe('light');
  });

  it('survives unavailable storage', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readChoice()).toBe('system');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});

describe('pre-paint script', () => {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

  it('is inline in <head>, before the module script, and uses the shared key', () => {
    expect(script).not.toBe('');
    expect(indexHtml.indexOf('<script>')).toBeLessThan(indexHtml.indexOf('type="module"'));
    expect(script).toContain(`localStorage.getItem('${THEME_KEY}')`);
  });

  it('sets data-theme from stored choice', () => {
    localStorage.setItem(THEME_KEY, 'light');
    new Function(script)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(script)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
