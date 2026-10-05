import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, cycleTheme, nextChoice, readChoice, resolveTheme } from '../src/lib/theme.ts';
import { THEME_KEY } from '../src/constants/storage.ts';

const dir = import.meta.dirname;
const indexHtml = readFileSync(join(dir, '../index.html'), 'utf8');

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
