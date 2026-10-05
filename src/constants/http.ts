/** HTTP / network constants shared by server, CLI, and tests. */
export const LOOPBACK_HOST = '127.0.0.1';
export const DEFAULT_PORT = 47616;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/** Mutating requests must send this header with value `MUTATION_HEADER_VALUE` and a JSON content type. */
export const MUTATION_HEADER = 'X-Crontick-Dashboard';
export const MUTATION_HEADER_VALUE = '1';
export const JSON_CONTENT_TYPE = 'application/json';
