import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getCardType } from '../../src/registry/registry.ts';
import '../../src/types/media/index.ts';
import example from '../../../templates/media.example.json';
import type { CardTypeProps } from '../../src/registry/registry.ts';
import type { MediaData } from '../../../src/index.js';

const def = getCardType('media')!;
type P = CardTypeProps<MediaData>;
const C = def.Component as React.ComponentType<P>;

function renderMedia(data: unknown, over: Partial<P> = {}) {
  return render(
    <C
      card={{ id: 'c1' } as never}
      data={data as MediaData}
      mode="grid"
      query=""
      checked={new Set()}
      pending={new Set()}
      onItemAction={async () => {}}
      {...over}
    />,
  );
}
const n = (k: number) => ({ items: Array.from({ length: k }, (_, i) => ({ src: `https://e.com/${i}.png`, alt: `a${i}` })) });

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('media type', () => {
  it('registers without alert mode', () => {
    expect(def.allowedModes).toEqual(['grid', 'now', 'fullscreen']);
  });

  it('searchText = alt + caption', () => {
    expect(def.searchText({ items: [{ src: 'https://e.com/a.png', alt: 'Door', caption: 'Front' }, { src: 'https://e.com/b.png' }] } as never)).toBe('Door Front');
  });

  it('img has required attributes', () => {
    const { container } = renderMedia({ items: [{ src: 'https://e.com/a.png', alt: 'Door', caption: 'Cap' }] });
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://e.com/a.png');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('alt')).toBe('Door');
    expect(container.querySelector('figure figcaption')!.textContent).toBe('Cap');
  });

  it('alt falls back to caption then "Image"', () => {
    const { container } = renderMedia({ items: [{ src: 'https://e.com/a.png', caption: 'Cap' }, { src: 'https://e.com/b.png' }] });
    const imgs = container.querySelectorAll('img');
    expect(imgs[0]!.getAttribute('alt')).toBe('Cap');
    expect(imgs[1]!.getAttribute('alt')).toBe('Image');
  });

  it('no <img> for disallowed srcs; placeholder shows alt', () => {
    const bad = ['javascript:alert(1)', 'file:///etc/passwd', '/local.png', 'data:text/html,<b>x</b>'];
    const { container } = renderMedia({ items: bad.map((src, i) => ({ src, alt: `bad${i}` })) });
    expect(container.querySelector('img')).toBeNull();
    for (let i = 0; i < bad.length; i++) screen.getByText(`bad${i}`);
  });

  it('data:image/svg+xml only via <img>, no inline svg/object/iframe', () => {
    const { container } = renderMedia({ items: [{ src: 'data:image/svg+xml;base64,PHN2Zy8+', alt: 's' }] });
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('svg,object,iframe,embed')).toBeNull();
  });

  it('load error keeps alt text and working link', () => {
    const { container } = renderMedia({ items: [{ src: 'https://e.com/a.png', alt: 'Door', caption: 'Cap', link: 'https://e.com/page' }] });
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    screen.getByText('Door');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://e.com/page');
  });

  it('link wraps image', () => {
    const { container } = renderMedia(example.data);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/cam/front');
    expect(a.querySelector('img')).not.toBeNull();
    expect(container.querySelectorAll('a').length).toBe(1);
  });

  it('layouts: grid default, single', () => {
    const g = renderMedia(n(2));
    expect(g.container.querySelector('.media-root--grid')).not.toBeNull();
    g.unmount();
    const s = renderMedia({ ...n(1), layout: 'single' });
    expect(s.container.querySelector('.media-root--single')).not.toBeNull();
  });

  it('compact: 6 + "+N more" opening fullscreen; fullscreen all', () => {
    const { container, unmount } = renderMedia(n(9));
    expect(container.querySelectorAll('figure').length).toBe(6);
    screen.getByRole('button', { name: '+3 more' }).click();
    expect(window.location.hash).toContain('view=full');
    unmount();
    const r = renderMedia(n(9), { mode: 'fullscreen' });
    expect(r.container.querySelectorAll('figure').length).toBe(9);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders 01 example with no axe violations', async () => {
    for (const mode of ['grid', 'fullscreen'] as const) {
      const { container, unmount } = renderMedia(example.data, { mode });
      const res = await axe.run(container);
      expect(res.violations).toEqual([]);
      unmount();
    }
  });
});
