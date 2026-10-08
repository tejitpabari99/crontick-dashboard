import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, unlink, utimes } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Clock } from '../clock.js';
import { errnoCode } from '../utils/errors.js';

export interface MoveToDoneOptions {
  feedDir: string;
  doneDir: string;
  /** File name directly under feedDir (no path separators). */
  file: string;
  clock: Clock;
  /** If set, the moved file's atime/mtime are set to this instant (the tick time). */
  touchAt?: Date;
}

/**
 * Rename `<feedDir>/<file>` into doneDir (suffix `-<ts>` on collision; EXDEV falls back to copy+unlink).
 * Returns the name it landed under, or undefined when the source was already gone.
 */
export async function moveToDone({ feedDir, doneDir, file, clock, touchAt }: MoveToDoneOptions): Promise<string | undefined> {
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
    if (code === 'ENOENT') return undefined;
    if (code !== 'EXDEV') throw err;
    try {
      await copyFile(src, dest);
    } catch (e2) {
      if (errnoCode(e2) === 'ENOENT') return undefined;
      throw e2;
    }
    await unlink(src).catch((e3: NodeJS.ErrnoException) => {
      if (e3.code !== 'ENOENT') throw e3;
    });
  }
  if (touchAt) await utimes(dest, touchAt, touchAt);
  return target;
}
