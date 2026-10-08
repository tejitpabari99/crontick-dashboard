import { MS_PER_MINUTE } from './time.js';

/** data.json size cap (bytes). */
export const MAX_CARD_BYTES = 1024 * 1024;
/** card.json (view definition) size cap (bytes). */
export const MAX_CARD_DEF_BYTES = 64 * 1024;
/** Alert file size cap (bytes). */
export const MAX_ALERT_BYTES = 16 * 1024;
/** Default data file name inside a card folder. */
export const DEFAULT_DATA_FILE = 'data.json';
/** Reserved view-definition file name; cannot be used as a `data` path. */
export const CARD_DEF_FILE = 'card.json';
/** Max length of the card.json `data` file name. */
export const MAX_DATA_PATH_CHARS = 200;
/** Required extension of the `data` file name. */
export const DATA_PATH_EXT = '.json';
/** Cards with `updatedAt` further ahead than this produce a clock-skew warning. */
export const CLOCK_SKEW_MS = 5 * MS_PER_MINUTE;
/** Card id shape (the envelope additionally rejects trailing "." and Windows reserved names). */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Link schemes allowed in card links (server validation and UI anchors). */
export const LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'ms-outlook:'] as const;
/** Subset opened in a new tab; the rest (ms-outlook:) open in-place. */
export const WEB_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;
