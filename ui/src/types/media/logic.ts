import type { MediaData, MediaItem } from '../../../../src/index.js';

export function mediaItems(data: MediaData): MediaItem[] {
  const items = (data as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items.filter((i) => i && typeof i === 'object') as MediaItem[]) : [];
}

export function mediaAlt(item: MediaItem): string {
  return item.alt || item.caption || 'Image';
}

export function mediaSearchText(data: MediaData): string {
  return mediaItems(data)
    .map((i) => [i.alt, i.caption].filter((x) => typeof x === 'string' && x !== '').join(' '))
    .filter((s) => s !== '')
    .join(' ');
}
