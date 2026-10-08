/** One line of markdown as plain text (links/images keep their label; block and emphasis syntax removed). */
export function stripMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/(\*\*|__|~~|[*_`])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
