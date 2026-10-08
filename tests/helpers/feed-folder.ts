import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Split a flat (v0.1) card JSON text into the card-folder view (card.json) and content (data.json) parts. */
export function splitLegacyCard(text: string): { card: string; data: string | null } {
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { card: text, data: null };
    o = parsed as Record<string, unknown>;
  } catch {
    return { card: text, data: null };
  }
  const o2 = { ...o };
  delete o2['id'];
  delete o2['kind'];
  const { type, title, size, notify, show, staleAfter, priority, ...rest } = o2;
  const card: Record<string, unknown> = { type, title };
  if (notify !== undefined) card['notify'] = notify;
  if (show !== undefined) card['show'] = show;
  if (staleAfter !== undefined) card['staleAfter'] = staleAfter;
  if (priority !== undefined) card['priority'] = priority;
  if (size !== undefined) card['layout'] = { height: size };
  return { card: JSON.stringify(card), data: JSON.stringify(rest) };
}

/** Write `feed/<id>/{card.json,data.json}` from a flat card JSON text. Returns the data.json path. */
export function putCard(feedDir: string, id: string, legacyText: string): string {
  const dir = join(feedDir, id);
  mkdirSync(dir, { recursive: true });
  const { card, data } = splitLegacyCard(legacyText);
  writeFileSync(join(dir, 'card.json'), card);
  const dataPath = join(dir, 'data.json');
  if (data !== null) writeFileSync(dataPath, data);
  return dataPath;
}
