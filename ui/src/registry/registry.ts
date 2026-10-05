import type { ComponentType } from 'react';
import type { KnownType, KpiData, ListData, MarkdownData, MediaData, TableData } from '../../../src/index.js';
import type { ViewCard } from '../api/types.ts';

export type Mode = 'grid' | 'now' | 'alert' | 'fullscreen';

/** Keys are the 01 registry type names. */
export type TypeName = KnownType;

export interface DataByType {
  markdown: MarkdownData;
  table: TableData;
  list: ListData;
  kpi: KpiData;
  media: MediaData;
}
export type DataOf<T extends TypeName> = T extends keyof DataByType ? DataByType[T] : never;

export interface CardTypeProps<D> {
  card: ViewCard;
  data: D;
  mode: Mode;
  /** Global search string ('' when none). */
  query: string;
  checked: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onItemAction(itemId: string): Promise<void>;
}

export interface CardTypeDef<D> {
  Component: ComponentType<CardTypeProps<D>>;
  searchText(data: D): string;
  allowedModes?: Mode[];
}

const defs = new Map<string, CardTypeDef<never>>();

export function registerCardType<T extends TypeName>(type: T, def: CardTypeDef<DataOf<T>>): void {
  defs.set(type, def as CardTypeDef<never>);
}

/** Lookup by raw server type string; undefined = unknown type (use UnknownBody). */
export function getCardType(type: string): CardTypeDef<unknown> | undefined {
  return defs.get(type) as CardTypeDef<unknown> | undefined;
}
