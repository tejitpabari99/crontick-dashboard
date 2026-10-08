/** `complete` write-back: edits checked/checkedAt in the raw card JSON, compare-and-rename, self-write registered. */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CARD_CHANGED_MESSAGE, ERROR_CODES } from '../constants/error-codes.js';
import { RENAME_TRIES, WRITEBACK_RENAME_BACKOFF_MS } from '../constants/state.js';
import { sameInstant } from '../instant.js';
import { isObj, type Obj } from '../utils/guards.js';
import { retryOnBusy } from '../utils/retry.js';
import { sleep as realSleep } from '../utils/sleep.js';
import type { ActionDeps, ActionRequest, ActionResult } from './registry.js';

const CHANGED: ActionResult = { ok: false, status: 409, error: CARD_CHANGED_MESSAGE, code: ERROR_CODES.CARD_CHANGED };

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** ISO-8601 with the local UTC offset, e.g. 2026-06-01T12:00:00.000+02:00. */
function isoLocal(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`
  );
}


function isComplete(action: unknown): boolean {
  return action === 'complete' || (isObj(action) && action['type'] === 'complete');
}

function findItem(obj: Obj, itemId: string): Obj | undefined {
  const data = obj['data'];
  const items = isObj(data) ? data['items'] : undefined;
  if (!Array.isArray(items)) return undefined;
  const it = items.find((i) => isObj(i) && i['id'] === itemId);
  return isObj(it) && isComplete(it['action']) ? it : undefined;
}

export async function completeWriteBack(req: ActionRequest, deps: ActionDeps): Promise<ActionResult> {
  const { entry, itemId, checked } = req;
  const { refreshFeed, selfWrites } = deps;
  const rename = deps.rename ?? renameSync;
  const sleep = deps.sleep ?? realSleep;
  const path = entry.dataPath;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: Buffer;
    let st: { mtimeMs: number; size: number };
    try {
      st = statSync(path);
      raw = readFileSync(path);
    } catch {
      refreshFeed(entry.file);
      return CHANGED;
    }
    const hash = sha256(raw);
    if (attempt === 0 && hash !== entry.dataHash) {
      refreshFeed(entry.file);
      return CHANGED;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(raw.toString('utf8'));
    } catch {
      refreshFeed(entry.file);
      return CHANGED;
    }
    if (!isObj(obj) || !sameInstant(obj['updatedAt'], req.updatedAt)) {
      refreshFeed(entry.file);
      return CHANGED;
    }
    const item = findItem(obj, itemId);
    if (!item) {
      refreshFeed(entry.file);
      return CHANGED;
    }
    if ((item['checked'] === true) === checked && (checked ? typeof item['checkedAt'] === 'string' : !('checkedAt' in item))) {
      return { ok: true }; // already in the requested state
    }
    item['checked'] = checked;
    if (checked) item['checkedAt'] = isoLocal(deps.clock.now());
    else delete item['checkedAt'];
    const bytes = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
    const newHash = sha256(bytes);
    const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
    let renamed = false;
    try {
      writeFileSync(tmp, bytes, { flag: 'wx' });
      selfWrites.set(entry.file, newHash);
      deps.hooks?.beforeCompare?.();
      let unchanged = false;
      try {
        const now = statSync(path);
        unchanged = now.mtimeMs === st.mtimeMs && now.size === st.size && sha256(readFileSync(path)) === hash;
      } catch {
        unchanged = false;
      }
      if (!unchanged) {
        if (selfWrites.get(entry.file) === newHash) selfWrites.delete(entry.file);
        refreshFeed(entry.file);
        continue;
      }
      await retryOnBusy(() => rename(tmp, path), { tries: RENAME_TRIES, backoffMs: WRITEBACK_RENAME_BACKOFF_MS, sleep });
      renamed = true;
    } catch (e) {
      if (selfWrites.get(entry.file) === newHash) selfWrites.delete(entry.file);
      throw e;
    } finally {
      if (!renamed) rmSync(tmp, { force: true });
    }
    refreshFeed(entry.file);
    return { ok: true };
  }
  return CHANGED;
}
