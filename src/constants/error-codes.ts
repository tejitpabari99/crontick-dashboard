/** Machine-readable error codes: HTTP `{ error, code }` bodies, `AppError.code`, CLI `--verbose` output. */
export const ERROR_CODES = {
  // HTTP
  HOST_FORBIDDEN: 'HOST_FORBIDDEN',
  MUTATION_HEADER_REQUIRED: 'MUTATION_HEADER_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_BODY: 'INVALID_BODY',
  CARD_NOT_FOUND: 'CARD_NOT_FOUND',
  CARD_BROKEN: 'CARD_BROKEN',
  CARD_CHANGED: 'CARD_CHANGED',
  NOT_AN_ALERT: 'NOT_AN_ALERT',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  ITEM_NO_ACTION: 'ITEM_NO_ACTION',
  DISMISS_NOT_UNCHECKABLE: 'DISMISS_NOT_UNCHECKABLE',
  INTERNAL: 'INTERNAL',
  // Lifecycle / CLI
  NOT_BUILT: 'NOT_BUILT',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  DAEMON_START_FAILED: 'DAEMON_START_FAILED',
  DAEMON_START_TIMEOUT: 'DAEMON_START_TIMEOUT',
  DAEMON_STOP_TIMEOUT: 'DAEMON_STOP_TIMEOUT',
  LOCK_TIMEOUT: 'LOCK_TIMEOUT',
  PACKAGE_ROOT_NOT_FOUND: 'PACKAGE_ROOT_NOT_FOUND',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  SKILL_DIFFERS: 'SKILL_DIFFERS',
  INVALID_PORT: 'INVALID_PORT',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  FILE_UNREADABLE: 'FILE_UNREADABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Shared by the HTTP layer and write-back so every CARD_CHANGED response reads the same. */
export const CARD_CHANGED_MESSAGE = 'card was updated; reload and retry';

/** Why a card folder or alert file is Broken (card still shown, with an error). Source for validator, snapshot and docs/reference/errors.md. */
export const BROKEN_REASONS = [
  'unreadable',
  'malformed-json',
  'not-object',
  'too-large',
  'schema-invalid',
  'unknown-type',
] as const;
export type BrokenReason = (typeof BROKEN_REASONS)[number];

/** Why a card folder is skipped entirely (surfaced as a snapshot warning). */
export const SKIP_REASONS = [
  'card-def-missing',
  'card-def-invalid',
  'data-path-invalid',
  'invalid-id',
  'reserved-id',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
