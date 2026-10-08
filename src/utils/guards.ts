export type Obj = Record<string, unknown>;

/** Plain (non-array, non-null) object. */
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `v` if it is a plain object, else `{}`. */
export const asRecord = (v: unknown): Obj => (isObj(v) ? v : {});

/** Array elements coerced with `asRecord`; `[]` when `v` is not an array. */
export const asRecords = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(asRecord) : []);

/** String or number as a string, else ''. */
export const asText = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
