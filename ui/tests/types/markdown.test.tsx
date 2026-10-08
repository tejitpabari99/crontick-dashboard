import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import '../../src/types/markdown/index.ts';
import example from '../../../templates/markdown/data.json';
import type { CardTypeProps } from '../../src/registry/registry.ts';
import type { MarkdownData } from '../../../src/index.js';

const def = getCardType('markdown')!;

function renderMd(text: string, mode: CardTypeProps<MarkdownData>['mode'] = 'column') {
  const C = def.Component as React.ComponentType<CardTypeProps<MarkdownData>>;
  return render(
    <C
      card={{} as never}
      data={{ text }}
      mode={mode}
      query=""
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
    />,
  );
}

describe('markdown type', () => {
  it('registers, searchText = text and is total', () => {
    expect(def).toBeDefined();
    expect(def.searchText({ text: 'hi **there**' })).toBe('hi **there**');
    expect(def.searchText({} as never)).toBe('');
    expect(def.searchText(null as never)).toBe('');
    expect(def.searchText({ text: 5 } as never)).toBe('');
  });

  it('drops raw HTML', () => {
    const { container } = renderMd(
      'a <script>window.x=1</script> b\n\n<img src="https://e.com/a.png" onerror="alert(1)">\n\n<a href="javascript:alert(1)">bad</a>\n\n<b>bold</b>',
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|javascript:/i);
  });

  it('javascript: markdown links render as plain text', () => {
    const { container } = renderMd('[click](javascript:alert(1)) and [rel](/foo) and [h](#x)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click');
    expect(container.textContent).toContain('rel');
  });

  it('safe links carry target and rel', () => {
    renderMd('[doc](https://example.com/x) <https://auto.example.com>');
    const a = screen.getByRole('link', { name: /doc/ });
    expect(a.getAttribute('href')).toBe('https://example.com/x');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('images use safeImageSrc', () => {
    const { container } = renderMd(
      '![ok](https://e.com/a.png) ![bad](file:///etc/passwd) ![js](javascript:alert(1)) ![d](data:image/png;base64,AAAA)',
    );
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['https://e.com/a.png', 'data:image/png;base64,AAAA']);
    for (const i of imgs) {
      expect(i.getAttribute('loading')).toBe('lazy');
      expect(i.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
    expect(container.innerHTML).not.toContain('file:');
    expect(container.textContent).toContain('bad');
  });

  it('never renders h1; headings demoted', () => {
    const { container } = renderMd('# a\n## b\n### c\n###### f');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();
    expect(Array.from(container.querySelectorAll('h3,h4,h5,h6')).map((h) => h.tagName)).toEqual(['H3', 'H4', 'H5', 'H6']);
  });

  it('GFM: table in scroll wrapper, strikethrough, disabled task list, code', () => {
    const { container } = renderMd('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo\n\n```\ncode\n```');
    expect(container.querySelector('.md-table-wrap table')).not.toBeNull();
    expect(container.querySelector('del')?.textContent).toBe('gone');
    const boxes = container.querySelectorAll('input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect((b as HTMLInputElement).disabled).toBe(true));
    expect(container.querySelector('pre code')?.textContent).toContain('code');
  });

  it('empty shows (empty)', () => {
    renderMd('   ');
    expect(screen.getByText('(empty)')).toBeTruthy();
  });

  it('renders templates/markdown/data.json', () => {
    const { container } = renderMd((example.data as MarkdownData).text);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h4')?.textContent).toBe('Today');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /runbook/ }).getAttribute('href')).toBe('https://example.com/runbook');
  });
});
