import { describe, it, expect } from 'vitest';
import { matchesQuery } from '../../server/logic/queryMatcher.ts';

describe('matchesQuery', () => {
  it('matches when every top level field in the query equals the document', () => {
    const doc = { _id: '1', owner: 'ada', done: false };

    expect(matchesQuery(doc, { owner: 'ada', done: false })).toBe(true);
  });

  it('does not match when a queried field differs', () => {
    expect(matchesQuery({ _id: '1', owner: 'bob' }, { owner: 'ada' })).toBe(false);
  });

  it('matches on _id like any other field', () => {
    expect(matchesQuery({ _id: 'room-1', owner: 'ada' }, { _id: 'room-1' })).toBe(true);
    expect(matchesQuery({ _id: 'room-2', owner: 'ada' }, { _id: 'room-1' })).toBe(false);
  });

  it('matches every document when the query is empty', () => {
    expect(matchesQuery({ _id: '1', owner: 'ada' }, {})).toBe(true);
  });
});
