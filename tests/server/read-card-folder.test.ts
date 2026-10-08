import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAndValidateCardFolder, readCardFolder } from '../../src/feed/read-card-folder.js';

let root: string;
let dir: string;
const card = (extra: object = {}) => JSON.stringify({ type: 'markdown', title: 'T', ...extra });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rcf-'));
  dir = join(root, 'feed', 'x');
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function canSymlink(): boolean {
  const t = mkdtempSync(join(tmpdir(), 'rcf-probe-'));
  try {
    symlinkSync(t, join(t, 'probe'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
}
const symlinks = canSymlink();

describe('readCardFolder', () => {
  it('card.json missing -> cardText null, skipped card-def-missing', () => {
    const r = readCardFolder(dir);
    expect(r.cardText).toBeNull();
    expect(r.cardMtimeMs).toBeUndefined();
    expect(r.data).toEqual({ absent: true });
    expect(readAndValidateCardFolder(dir).result).toMatchObject({ status: 'skipped', reason: 'card-def-missing' });
  });

  it('data absent -> absent with card mtime', () => {
    writeFileSync(join(dir, 'card.json'), card());
    const r = readCardFolder(dir);
    expect(r.folderId).toBe('x');
    expect(r.data).toEqual({ absent: true });
    expect(r.dataPath).toBe('data.json');
    expect(typeof r.cardMtimeMs).toBe('number');
    expect(readAndValidateCardFolder(dir).result.status).toBe('no-data');
  });

  it('data unreadable (a directory) -> unreadable', () => {
    writeFileSync(join(dir, 'card.json'), card());
    mkdirSync(join(dir, 'data.json'));
    const r = readCardFolder(dir);
    expect('unreadable' in r.data).toBe(true);
    expect(readAndValidateCardFolder(dir).result).toMatchObject({ status: 'broken', reason: 'unreadable' });
  });

  it('plain data file -> text + mtime', () => {
    writeFileSync(join(dir, 'card.json'), card());
    writeFileSync(join(dir, 'data.json'), '{"text":"hi"}');
    const r = readCardFolder(dir);
    expect(r.data).toMatchObject({ text: '{"text":"hi"}' });
    expect((r.data as { mtimeMs: number }).mtimeMs).toBeGreaterThan(0);
    expect(r.preset).toBeUndefined();
  });

  it('custom data name', () => {
    writeFileSync(join(dir, 'card.json'), card({ data: 'metrics.json' }));
    writeFileSync(join(dir, 'metrics.json'), '{"b":2}');
    const r = readCardFolder(dir);
    expect(r.dataPath).toBe('metrics.json');
    expect(r.data).toMatchObject({ text: '{"b":2}' });
  });

  it('invalid data path from SP01 is not read', () => {
    writeFileSync(join(dir, 'card.json'), card({ data: '../secret.json' }));
    const { result } = readAndValidateCardFolder(dir);
    expect(result).toMatchObject({ status: 'skipped', reason: 'data-path-invalid' });
  });

  it.skipIf(!symlinks)('symlink escaping the folder -> skipped data-path-invalid', () => {
    writeFileSync(join(root, 'outside.json'), '{"secret":1}');
    symlinkSync(join(root, 'outside.json'), join(dir, 'data.json'));
    writeFileSync(join(dir, 'card.json'), card());
    const r = readCardFolder(dir);
    expect(r.preset).toMatchObject({ status: 'skipped', reason: 'data-path-invalid' });
    expect(r.data).toEqual({ absent: true });
    expect(readAndValidateCardFolder(dir).result).toMatchObject({ status: 'skipped', reason: 'data-path-invalid' });
  });

  it.skipIf(!symlinks)('symlink staying inside the folder is read', () => {
    writeFileSync(join(dir, 'real.json'), '{"c":3}');
    symlinkSync(join(dir, 'real.json'), join(dir, 'data.json'));
    writeFileSync(join(dir, 'card.json'), card());
    const r = readCardFolder(dir);
    expect(r.preset).toBeUndefined();
    expect(r.data).toMatchObject({ text: '{"c":3}' });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('card.json unreadable -> preset skipped', () => {
    writeFileSync(join(dir, 'card.json'), card());
    chmodSync(join(dir, 'card.json'), 0o000);
    expect(readCardFolder(dir).preset).toMatchObject({ status: 'skipped', reason: 'card-def-invalid' });
  });
});
