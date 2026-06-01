import { describe, it, expect } from 'vitest';
import { hasMongoOperator } from '../../shared/helperFunctions.ts';

describe('hasMongoOperator', () => {
  it('returns false for primitives and safe nested objects', () => {
    expect(hasMongoOperator(null)).toBe(false);
    expect(hasMongoOperator(undefined)).toBe(false);
    expect(hasMongoOperator('string')).toBe(false);
    expect(hasMongoOperator(42)).toBe(false);
    expect(hasMongoOperator({ folderId: 'a', status: 'complete' })).toBe(false);
    expect(hasMongoOperator({ nested: { value: 1 }, arr: [1, 'two'] })).toBe(false);
  });

  it('returns true for direct mongo operator keys', () => {
    expect(hasMongoOperator({ $ne: null })).toBe(true);
    expect(hasMongoOperator({ folderId: { $in: ['a', 'b'] } })).toBe(true);
  });

  it('returns true for nested mongo operators at any depth', () => {
    expect(hasMongoOperator({ folderId: 'a', status: { $ne: null } })).toBe(true);
    expect(hasMongoOperator({ deep: { nested: { $gt: 5 } } })).toBe(true);
  });

  it('returns true for mongo operators nested inside arrays', () => {
    expect(hasMongoOperator([1, { $exists: true }, 3])).toBe(true);
    expect(hasMongoOperator({ arr: [1, { nested: { $lt: 10 } }] })).toBe(true);
  });
});
