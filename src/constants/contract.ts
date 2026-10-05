import { MS_PER_MINUTE } from './time.js';

/** Card file size cap (bytes). */
export const MAX_CARD_BYTES = 1024 * 1024;
/** Cards with `updatedAt` further ahead than this produce a clock-skew warning. */
export const CLOCK_SKEW_MS = 5 * MS_PER_MINUTE;
/** Card id shape (the envelope additionally rejects trailing "." and Windows reserved names). */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Link schemes allowed in card links (server validation and UI anchors). */
export const LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'ms-outlook:'] as const;
/** Subset opened in a new tab; the rest (ms-outlook:) open in-place. */
export const WEB_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;
