import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listTypes } from '../../src/index.js';
import { ErrorBoundary } from '../src/frame/ErrorBoundary.tsx';
import { CardLink } from '../src/frame/CardLink.tsx';
import { getCardType, registerCardType } from '../src/registry/registry.ts';
import { UnknownBody } from '../src/registry/unknown.tsx';
import '../src/types/index.ts';

afterEach(cleanup);

describe('unknown type', () => {
  it('renders the fallback body', () => {
    render(<UnknownBody type="holo" />);
    expect(screen.getByText(/Unsupported type/).textContent).toContain('holo');
  });
  it('getCardType misses return undefined', () => {
    expect(getCardType('nope-not-registered')).toBeUndefined();
  });
});

describe('registry', () => {
  it('register + get', () => {
    const Component = () => <p>x</p>;
    // @ts-expect-error deliberately not a 01 type name
    registerCardType('zz-test', { Component, searchText: () => 'abc' });
    expect(getCardType('zz-test')?.searchText({} as never)).toBe('abc');
  });
  // PENDING until 04 registers its five types in ui/src/types/index.ts; then switch to `it`.
  it.todo('every 01 listTypes() name has a registered def (enable when 04 lands)');
  it('listTypes() is importable from a ui test', () => {
    expect(listTypes().length).toBeGreaterThan(0);
  });
});

describe('ErrorBoundary', () => {
  it('contains a throwing child', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('kaboom');
    };
    render(
      <div>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
        <p>sibling</p>
      </div>,
    );
    expect(screen.getByText(/Render error/)).toBeTruthy();
    expect(screen.getByText('sibling')).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('CardLink', () => {
  it.each([
    ['https://a.example/x', true],
    ['http://a.example', true],
    ['mailto:a@b.co', true],
  ])('%s opens in new tab safely', (href) => {
    render(<CardLink href={href}>go</CardLink>);
    const a = screen.getByRole('link');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toContain('↗');
  });
  it('ms-outlook: plain anchor, no target', () => {
    render(<CardLink href="ms-outlook://emails">m</CardLink>);
    const a = screen.getByRole('link');
    expect(a.getAttribute('href')).toBe('ms-outlook://emails');
    expect(a.hasAttribute('target')).toBe(false);
  });
  it.each([
    'javascript:alert(1)',
    ' JaVaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'ftp://x',
    '/relative',
    '#hash',
    'not a url',
    '',
  ])('%j is plain text, never an anchor', (href) => {
    const { container } = render(<CardLink href={href}>label</CardLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('label');
  });
  it('has title tooltip from text and clamp class', () => {
    render(<CardLink href="https://a.example">Long text</CardLink>);
    const a = screen.getByRole('link');
    expect(a.getAttribute('title')).toBe('Long text');
    expect(a.className).toContain('card-link');
  });
  it('CSS has :visited rules', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/frame/card-link.css'), 'utf8');
    expect(css).toMatch(/a\.card-link:not\(:visited\)[^{]*\{[^}]*var\(--primary\)/);
    expect(css).toMatch(/a\.card-link:visited[^{]*\{[^}]*var\(--text-muted\)/);
    expect(css).toMatch(/:visited[^{]*\.card-link__glyph/);
    expect(css).toMatch(/-webkit-line-clamp:\s*2/);
  });
});
