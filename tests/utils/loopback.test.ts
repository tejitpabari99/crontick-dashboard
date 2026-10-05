import { describe, expect, it } from 'vitest';
import { loopbackHost, loopbackUrl } from '../../src/utils/loopback.js';

describe('loopback', () => {
  it('builds host and url', () => {
    expect(loopbackHost(4321)).toBe('127.0.0.1:4321');
    expect(loopbackUrl(4321)).toBe('http://127.0.0.1:4321');
    expect(loopbackUrl(4321, '/#card=a')).toBe('http://127.0.0.1:4321/#card=a');
  });
});
