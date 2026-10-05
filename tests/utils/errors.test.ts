import { describe, expect, it } from 'vitest';
import { errnoCode, errorMessage } from '../../src/utils/errors.js';

describe('errorMessage', () => {
  it('uses Error.message, else stringifies', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('x')).toBe('x');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('errnoCode', () => {
  it('returns a string code only', () => {
    expect(errnoCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errnoCode(new Error('x'))).toBeUndefined();
    expect(errnoCode({ code: 5 })).toBeUndefined();
    expect(errnoCode(null)).toBeUndefined();
    expect(errnoCode(undefined)).toBeUndefined();
  });
});
