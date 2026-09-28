import { describe, it, expect } from 'vitest';
import { matchesQuery, unsupportedOperators, verdictFor } from '../../server/logic/queryMatcher.ts';

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

// The live path decides membership change by change. A change does not always carry
// the whole document: the Nulled Mongo emits only what an update set, and the real
// one falls back to the updated fields when the document is gone by the time it
// looks it up. So the matcher answers in three values, and `unknown` is an answer.
describe('verdictFor, on a whole document', () => {
  const doc = {
    _id: 'task-1',
    owner: 'ada',
    done: false,
    points: 5,
    tags: ['urgent', 'home'],
    meta: { kind: 'chore', by: { name: 'ada' } },
    due: new Date('2026-10-01T00:00:00Z'),
    lines: [{ sku: 'a' }, { sku: 'b' }],
    nothing: null,
  };

  it('answers match or no-match, never unknown', () => {
    expect(verdictFor(doc, { owner: 'ada' })).toBe('match');
    expect(verdictFor(doc, { owner: 'bob' })).toBe('no-match');
    expect(verdictFor(doc, { missing: 'x' })).toBe('no-match');
  });

  it('follows a dotted path into an embedded document', () => {
    expect(verdictFor(doc, { 'meta.kind': 'chore' })).toBe('match');
    expect(verdictFor(doc, { 'meta.by.name': 'ada' })).toBe('match');
    expect(verdictFor(doc, { 'meta.kind': 'errand' })).toBe('no-match');
  });

  it('matches a value held in an array, as Mongo does', () => {
    expect(verdictFor(doc, { tags: 'urgent' })).toBe('match');
    expect(verdictFor(doc, { tags: 'work' })).toBe('no-match');
    expect(verdictFor(doc, { tags: ['urgent', 'home'] })).toBe('match');
    expect(verdictFor(doc, { 'lines.sku': 'b' })).toBe('match');
  });

  it('reads a number in a path as a place in an array', () => {
    expect(verdictFor(doc, { 'tags.0': 'urgent' })).toBe('match');
    expect(verdictFor(doc, { 'tags.1': 'urgent' })).toBe('no-match');
    expect(verdictFor(doc, { 'tags.5': { $exists: true } })).toBe('no-match');
    expect(verdictFor(doc, { 'lines.1.sku': 'b' })).toBe('match');
  });

  it('matches an embedded document only when it is the same, in the same order', () => {
    expect(verdictFor(doc, { 'meta.by': { name: 'ada' } })).toBe('match');
    expect(verdictFor(doc, { 'meta.by': { name: 'bob' } })).toBe('no-match');
  });

  it('matches null against a null field and against a missing one', () => {
    expect(verdictFor(doc, { nothing: null })).toBe('match');
    expect(verdictFor(doc, { missing: null })).toBe('match');
    expect(verdictFor(doc, { owner: null })).toBe('no-match');
  });

  it('compares dates by their moment', () => {
    expect(verdictFor(doc, { due: new Date('2026-10-01T00:00:00Z') })).toBe('match');
    expect(verdictFor(doc, { due: { $gte: new Date('2026-09-01T00:00:00Z') } })).toBe('match');
    expect(verdictFor(doc, { due: { $lt: new Date('2026-09-01T00:00:00Z') } })).toBe('no-match');
  });

  it('matches an id held as an ObjectId against the string the change carries', () => {
    const hex = '64b7f0c2a1b2c3d4e5f60718';
    const objectId = { toHexString: () => hex, toString: () => hex };

    expect(verdictFor({ _id: hex }, { _id: objectId })).toBe('match');
    expect(verdictFor({ _id: 'ffffffffffffffffffffffff' }, { _id: objectId })).toBe('no-match');
  });

  it.each([
    [{ owner: { $eq: 'ada' } }, 'match'],
    [{ owner: { $ne: 'ada' } }, 'no-match'],
    [{ missing: { $ne: 'ada' } }, 'match'],
    [{ owner: { $in: ['ada', 'bob'] } }, 'match'],
    [{ owner: { $in: ['bob'] } }, 'no-match'],
    [{ tags: { $in: ['home'] } }, 'match'],
    [{ owner: { $nin: ['bob'] } }, 'match'],
    [{ owner: { $nin: ['ada'] } }, 'no-match'],
    [{ points: { $gt: 4 } }, 'match'],
    [{ points: { $gt: 5 } }, 'no-match'],
    [{ points: { $gte: 5, $lte: 5 } }, 'match'],
    [{ points: { $lt: 5 } }, 'no-match'],
    [{ owner: { $gt: 4 } }, 'no-match'],
    [{ owner: { $exists: true } }, 'match'],
    [{ missing: { $exists: true } }, 'no-match'],
    [{ missing: { $exists: false } }, 'match'],
  ])('answers %j with %s', (query, verdict) => {
    expect(verdictFor(doc, query)).toBe(verdict);
  });

  it.each([
    [{ $and: [{ owner: 'ada' }, { done: false }] }, 'match'],
    [{ $and: [{ owner: 'ada' }, { done: true }] }, 'no-match'],
    [{ $or: [{ owner: 'bob' }, { done: false }] }, 'match'],
    [{ $or: [{ owner: 'bob' }, { done: true }] }, 'no-match'],
    [{ $nor: [{ owner: 'bob' }, { done: true }] }, 'match'],
    [{ $nor: [{ owner: 'ada' }] }, 'no-match'],
    [{ owner: 'ada', $or: [{ points: 1 }, { points: 5 }] }, 'match'],
  ])('answers %j with %s', (query, verdict) => {
    expect(verdictFor(doc, query)).toBe(verdict);
  });
});

describe('verdictFor, on part of a document', () => {
  const partial = { partial: true } as const;

  it('decides on a field the change carries', () => {
    expect(verdictFor({ owner: 'ada' }, { owner: 'ada' }, partial)).toBe('match');
    expect(verdictFor({ owner: 'bob' }, { owner: 'ada' }, partial)).toBe('no-match');
  });

  it('answers unknown for a field the change does not carry', () => {
    expect(verdictFor({ title: 'renamed' }, { owner: 'ada' }, partial)).toBe('unknown');
  });

  it('is no-match as soon as one carried field fails, whatever is missing', () => {
    expect(verdictFor({ owner: 'bob' }, { owner: 'ada', done: false }, partial)).toBe('no-match');
  });

  it('is unknown when what it carries holds and the rest is missing', () => {
    expect(verdictFor({ owner: 'ada' }, { owner: 'ada', done: false }, partial)).toBe('unknown');
  });

  it('reads a dotted key as the update wrote it', () => {
    expect(verdictFor({ 'meta.kind': 'chore' }, { 'meta.kind': 'chore' }, partial)).toBe('match');
    expect(verdictFor({ meta: { kind: 'chore' } }, { 'meta.kind': 'chore' }, partial)).toBe(
      'match',
    );
  });

  it('answers unknown when the update wrote beneath the field the query reads', () => {
    expect(verdictFor({ 'meta.kind': 'chore' }, { meta: { kind: 'chore' } }, partial)).toBe(
      'unknown',
    );
  });

  it('carries unknown through the logical operators', () => {
    expect(verdictFor({ owner: 'ada' }, { $or: [{ owner: 'ada' }, { done: true }] }, partial)).toBe(
      'match',
    );
    expect(verdictFor({ owner: 'bob' }, { $or: [{ owner: 'ada' }, { done: true }] }, partial)).toBe(
      'unknown',
    );
    expect(
      verdictFor({ owner: 'bob' }, { $and: [{ owner: 'ada' }, { done: true }] }, partial),
    ).toBe('no-match');
    expect(verdictFor({ title: 'x' }, { $nor: [{ owner: 'ada' }] }, partial)).toBe('unknown');
  });
});

describe('unsupportedOperators', () => {
  it('finds nothing in a query the matcher can follow', () => {
    expect(unsupportedOperators({})).toEqual([]);
    expect(
      unsupportedOperators({
        owner: 'ada',
        points: { $gte: 1, $lt: 9 },
        $or: [{ tags: { $in: ['a'] } }, { done: { $exists: false } }],
      }),
    ).toEqual([]);
  });

  it('names each operator it cannot follow, once', () => {
    expect(
      unsupportedOperators({
        name: { $regex: '^a' },
        tags: { $all: ['a'], $size: 2 },
        $or: [{ lines: { $elemMatch: { sku: 'a' } } }, { name: { $regex: 'b$' } }],
        $where: 'this.a > 1',
      }),
    ).toEqual(['$regex', '$all', '$size', '$elemMatch', '$where']);
  });

  it('treats a regular expression given as a value as $regex', () => {
    expect(unsupportedOperators({ name: /^a/ })).toEqual(['$regex']);
    expect(unsupportedOperators({ name: { $in: [/^a/] } })).toEqual(['$regex']);
  });

  it('does not take an embedded document for an operator', () => {
    expect(unsupportedOperators({ meta: { kind: 'chore' } })).toEqual([]);
  });
});
