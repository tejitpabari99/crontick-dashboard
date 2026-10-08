/**
 * Shared fs adapter for a card folder: reads card.json and the data file it names (realpath-contained)
 * and returns the inputs for SP01's `validateCardFolder`. Used by ingest and the CLI so both resolve
 * folders identically. Synchronous; never throws for ordinary fs errors.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { CARD_DEF_FILE } from '../constants/contract.js';
import {
  parseCardDef,
  validateCardFolder,
  type DataInput,
  type FolderResult,
  type SkippedResult,
} from '../contract/folder-validate.js';
import { errnoCode, errorMessage } from '../utils/errors.js';

export interface CardFolderRead {
  folderId: string;
  cardText: string | null;
  data: DataInput;
  /** card.json mtime (reference for `staleAfter` on no-data cards); undefined when card.json is missing. */
  cardMtimeMs?: number;
  /** Resolved data file name from card.json (for write-back); undefined when card.json did not parse. */
  dataPath?: string;
  /**
   * Set when fs-level checks already decide the outcome (card.json unreadable, data path escapes the
   * folder via symlink). `validateCardFolder` is bypassed: use this result as is.
   */
  preset?: SkippedResult;
}

function skipped(reason: SkippedResult['reason'], message: string, id: string): SkippedResult {
  return { status: 'skipped', reason, message, issues: [], id };
}

function readData(dir: string, dataPath: string): { data: DataInput; escaped?: true } {
  let real: string;
  try {
    const root = realpathSync(dir);
    real = realpathSync(join(dir, dataPath));
    if (!real.startsWith(root.endsWith(sep) ? root : root + sep)) return { data: { absent: true }, escaped: true };
  } catch (e) {
    const code = errnoCode(e);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { data: { absent: true } };
    return { data: { unreadable: errorMessage(e) } };
  }
  try {
    const mtimeMs = statSync(real).mtimeMs;
    return { data: { text: readFileSync(real, 'utf8'), mtimeMs } };
  } catch (e) {
    if (errnoCode(e) === 'ENOENT') return { data: { absent: true } };
    return { data: { unreadable: errorMessage(e) } };
  }
}

/** Read `dir` (a `feed/<id>` folder). The folder id is `basename(dir)`. */
export function readCardFolder(dir: string): CardFolderRead {
  const folderId = basename(dir);
  const cardFile = join(dir, CARD_DEF_FILE);
  let cardText: string | null = null;
  let cardMtimeMs: number | undefined;
  try {
    cardMtimeMs = statSync(cardFile).mtimeMs;
    cardText = readFileSync(cardFile, 'utf8');
  } catch (e) {
    const code = errnoCode(e);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      return {
        folderId,
        cardText: null,
        data: { absent: true },
        preset: skipped('card-def-invalid', `${CARD_DEF_FILE}: ${errorMessage(e)}`, folderId),
      };
    }
    cardText = null;
    cardMtimeMs = undefined;
  }

  const base = { folderId, cardText, ...(cardMtimeMs !== undefined ? { cardMtimeMs } : {}) };
  const def = parseCardDef(folderId, cardText);
  if (def.status !== 'ok') return { ...base, data: { absent: true } };

  const { data, escaped } = readData(dir, def.dataPath);
  return {
    ...base,
    data,
    dataPath: def.dataPath,
    ...(escaped
      ? {
          preset: skipped(
            'data-path-invalid',
            `card.json data "${def.dataPath}" resolves outside the card folder`,
            folderId,
          ),
        }
      : {}),
  };
}

/** Convenience: read + validate. Honors `preset`. */
export function readAndValidateCardFolder(dir: string, now?: Date): { read: CardFolderRead; result: FolderResult } {
  const read = readCardFolder(dir);
  const result =
    read.preset ??
    validateCardFolder({
      folderId: read.folderId,
      cardText: read.cardText,
      data: read.data,
      ...(now ? { now } : {}),
    });
  return { read, result };
}
