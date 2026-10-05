/** Keyed warnings registry. Values surface in the snapshot's `warnings` (Task 7 wires `list()` in). */
export interface Warnings {
  /** Set or replace the warning for `key`. */
  set(key: string, message: string): void;
  clear(key: string): void;
  /** Current messages in first-set order. */
  list(): string[];
}

export function createWarnings(): Warnings {
  const map = new Map<string, string>();
  return {
    set: (key, message) => void map.set(key, message),
    clear: (key) => void map.delete(key),
    list: () => [...map.values()],
  };
}
