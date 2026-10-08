import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewCard } from '../src/api/types.ts';
import { registerCardType } from '../src/registry/registry.ts';
import { NowZone } from '../src/zones/NowZone.tsx';
import { vcard } from './helpers/snapshot.ts';

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-now', { Component: (p: { mode: string }) => <p>BODY-{p.mode}</p>, searchText: () => '' });

const card = (id: string, over: Partial<ViewCard> = {}): ViewCard => vcard(id, 'zz-now', over);

const common = {
  query: '',
  checked: () => new Set<string>() as ReadonlySet<string>,
  pending: () => new Set<string>() as ReadonlySet<string>,
  nowPriorityThreshold: 5,
  onItemAction: async () => {},
  onDone: () => {},
  onHide: () => {},
  onFullscreen: () => {},
};

afterEach(cleanup);

describe('NowZone', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<NowZone panels={[]} {...common} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders cards in now mode via the frame, stacked in order, with no alert strip', () => {
    render(<NowZone panels={[card('p2'), card('p1')]} {...common} />);
    const els = document.querySelectorAll('[data-card-id]');
    expect([...els].map((e) => e.getAttribute('data-card-id'))).toEqual(['p2', 'p1']);
    expect(screen.getAllByText('BODY-now')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: /alerts/i })).toBeNull();
  });
});
