import { describe, expect, it } from 'vitest';
import { matchCards } from '../src/lib/search.ts';

const cards = [
  { id: '1', title: 'Team Roster', status: 'ok' as const, searchText: 'Dana Lee on-call' },
  { id: '2', title: 'Deploys', status: 'ok' as const, searchText: 'dana staging' },
  { id: '3', title: 'Backup', status: 'broken' as const, message: 'File missing', searchText: 'dana secret' },
];

describe('search', () => {
  it('empty query matches nothing (no filter)', () => {
    expect(matchCards(cards, '   ')).toEqual([]);
  });
  it('case-insensitive title + searchText', () => {
    expect(matchCards(cards, 'DANA')).toEqual(['1', '2']);
    expect(matchCards(cards, 'roster')).toEqual(['1']);
  });
  it('AND over whitespace tokens', () => {
    expect(matchCards(cards, 'dana  staging')).toEqual(['2']);
    expect(matchCards(cards, 'dana nomatch')).toEqual([]);
  });
  it('broken cards match title + message only', () => {
    expect(matchCards(cards, 'secret')).toEqual([]);
    expect(matchCards(cards, 'backup missing')).toEqual(['3']);
  });
});
