import { describe, expect, it } from 'vitest';
import { MAX_PORT } from '../../src/constants/http.js';
import { parsePort } from '../../src/utils/port.js';

describe('parsePort', () => {
  it('accepts integers and decimal strings in range', () => {
    expect(parsePort(8080)).toBe(8080);
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort(1)).toBe(1);
    expect(parsePort(MAX_PORT)).toBe(MAX_PORT);
  });

  it('rejects out-of-range, fractional, and non-numeric input', () => {
    for (const v of [0, '0', -1, MAX_PORT + 1, 1.5, 'abc', '', ' 80', '80x', '1e3', null, undefined, {}, NaN]) {
      expect(parsePort(v)).toBeUndefined();
    }
  });

  it('allowZero accepts 0 (OS-assigned) only when asked', () => {
    expect(parsePort(0, { allowZero: true })).toBe(0);
    expect(parsePort('0', { allowZero: true })).toBe(0);
    expect(parsePort(MAX_PORT + 1, { allowZero: true })).toBeUndefined();
  });
});
