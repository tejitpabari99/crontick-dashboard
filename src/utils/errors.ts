/** Message of any thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** errno `code` (e.g. 'ENOENT') of a thrown value, if it has a string one. */
export function errnoCode(e: unknown): string | undefined {
  const code = (e as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}
