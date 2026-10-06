import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { moveToDone } from '../../src/feed/done.js';

let root: string;
let feedDir: string;
let doneDir: string;
const clock = fakeClock(1_700_000_000_000);
const move = (file: string) => moveToDone({ feedDir, doneDir, file, clock });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'done-'));
  feedDir = join(root, 'feed');
  doneDir = join(feedDir, 'done');
  mkdirSync(feedDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('moveToDone', () => {
  it('moves the file into done/, creating it', async () => {
    writeFileSync(join(feedDir, 'a.json'), 'one');
    await move('a.json');
    expect(existsSync(join(feedDir, 'a.json'))).toBe(false);
    expect(readFileSync(join(doneDir, 'a.json'), 'utf8')).toBe('one');
  });
  it('suffixes the clock time on collision', async () => {
    writeFileSync(join(feedDir, 'a.json'), 'one');
    await move('a.json');
    writeFileSync(join(feedDir, 'a.json'), 'two');
    await move('a.json');
    expect(readdirSync(doneDir).sort()).toEqual(['a-1700000000000.json', 'a.json']);
    expect(readFileSync(join(doneDir, 'a-1700000000000.json'), 'utf8')).toBe('two');
  });
  it('a file already gone is ok', async () => {
    await expect(move('gone.json')).resolves.toBeUndefined();
  });
  it('rejects names with path parts', async () => {
    await expect(move('../x.json')).rejects.toThrow('invalid feed file name');
  });
});
