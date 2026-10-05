import { registerCardType } from '../../registry/registry.ts';
import { MarkdownBody } from './MarkdownBody.tsx';

export function searchText(data: { text?: unknown } | null | undefined): string {
  return typeof data?.text === 'string' ? data.text : '';
}

registerCardType('markdown', { Component: MarkdownBody, searchText, allowedModes: ['grid', 'now', 'alert', 'fullscreen'] });
