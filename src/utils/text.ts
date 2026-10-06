/** "1 row", "2 rows". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
