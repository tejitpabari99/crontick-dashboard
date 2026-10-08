import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('AC9 portability: src/contract has no Node-only or DOM deps', () => {
  const root = join(import.meta.dirname, '../../src/contract');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);
  const NODE = /^(node:|fs$|fs\/|path$|os$|child_process$|crypto$|http$|https$|net$|stream$|url$|util$|buffer$|events$|worker_threads$|zlib$|vm$|process$)/;
  const specs = (src: string) =>
    [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  it('found source files', () => expect(files.length).toBeGreaterThan(5));
  it('imports are relative or allowed packages only', () => {
    for (const f of files) {
      for (const s of specs(readFileSync(f, 'utf8'))) {
        expect(NODE.test(s), `${f}: ${s}`).toBe(false);
        expect(s.startsWith('.') || ['zod', 'croner'].includes(s), `${f}: ${s}`).toBe(true);
      }
    }
  });
  it('no DOM or Node globals', () => {
    const re = /\b(window|document|navigator|localStorage|sessionStorage|XMLHttpRequest|require|__dirname|__filename|Buffer|process)\b\s*[.([]/;
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(re.test(code), f).toBe(false);
    }
  });
});
