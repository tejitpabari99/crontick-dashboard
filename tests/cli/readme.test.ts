import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT } from '../../src/config.js';

describe('README', () => {
  it('quotes the default port from DEFAULT_PORT', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const m = /Default port: (\d+)/.exec(readme);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(DEFAULT_PORT);
  });
});
