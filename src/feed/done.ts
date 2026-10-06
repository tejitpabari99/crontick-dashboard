import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Clock } from '../clock.js';
import { errnoCode } from '../utils/errors.js';

export interface MoveToDoneOptions {
  feedDir: string;
  doneDir: string;
  /** File name directly under feedDir (no path separators). */
  file: string;
  clock: Clock;
}

/** Rename `feed/<file>` to `feed/done/<file>` (suffix `-<ts>` on collision; EXDEV falls back to copy+unlink). Gone = ok. */
export async function moveToDone({ feedDir, doneDir, file, clock }: MoveToDoneOptions): Promise<void> {
  if (basename(file) !== file) throw new Error('invalid feed file name');
  const src = join(feedDir, file);
  await mkdir(doneDir, { recursive: true });
  let target = file;
  if (existsSync(join(doneDir, target))) {
    const ext = extname(file);
    target = `${file.slice(0, file.length - ext.length)}-${clock.now().getTime()}${ext}`;
  }
  const dest = join(doneDir, target);
  try {
    await rename(src, dest);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT') return;
    if (code !== 'EXDEV') throw err;
    try {
      await copyFile(src, dest);
    } catch (e2) {
      if (errnoCode(e2) === 'ENOENT') return;
      throw e2;
    }
    await unlink(src).catch((e3: NodeJS.ErrnoException) => {
      if (e3.code !== 'ENOENT') throw e3;
    });
  }
}
