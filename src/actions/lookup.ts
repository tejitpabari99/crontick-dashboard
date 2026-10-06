import { isObj } from '../utils/guards.js';

/**
 * Finds the item with `itemId` in a card's `data.items`. Undefined if there is no such item;
 * otherwise `{ type }` is the item's `action.type` (undefined when the item has no action).
 */
export function findItemAction(data: unknown, itemId: string): { type: string | undefined } | undefined {
  const items = isObj(data) ? data['items'] : undefined;
  if (!Array.isArray(items)) return undefined;
  const item: unknown = items.find((i) => isObj(i) && i['id'] === itemId);
  if (!isObj(item)) return undefined;
  const action = item['action'];
  const type = isObj(action) ? action['type'] : undefined;
  return { type: typeof type === 'string' ? type : undefined };
}
