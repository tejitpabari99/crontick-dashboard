/** Returns the trimmed src if it is http(s) or data:image/*, else null. SVG is only ever used inside <img>. */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return s;
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:' ? s : null;
  } catch {
    return null;
  }
}
