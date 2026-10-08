import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.js';

/** Message of any thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** errno `code` (e.g. 'ENOENT') of a thrown value, if it has a string one. */
export function errnoCode(e: unknown): string | undefined {
  const code = (e as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Typed error carrying a machine-readable `code` (see `ERROR_CODES`). Message tells the user what to do. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** NOT_BUILT: a build artifact (UI, server entry) is missing. One definition for every site. */
export function notBuiltError(what: string, path: string): AppError {
  return new AppError(
    ERROR_CODES.NOT_BUILT,
    `${what} not found at ${path}; run \`npm run build\` (from a source checkout) or reinstall the package`,
  );
}

/** `code` of an AppError, else undefined. */
export function appErrorCode(e: unknown): ErrorCode | undefined {
  return e instanceof AppError ? e.code : undefined;
}
