import type { ListData, ListItem } from '../../../../src/index.js';

export function listSearchText(data: ListData): string {
  return (Array.isArray(data?.items) ? data.items : []).map((i) => (i.subtitle ? `${i.text} ${i.subtitle}` : i.text)).join(' ');
}

export function itemText(item: ListItem): string {
  return item.subtitle ? `${item.text} ${item.subtitle}` : item.text;
}

/**
 * Timezone for due labels. The snapshot does not carry `config.timezone` yet, so use the browser's zone.
 * Isolated here so it can later read a snapshot value.
 */
export function dueTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
