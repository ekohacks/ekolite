import { describe, expect, it } from 'vitest';
import { flattenSuppressed } from '../../shared/helperFunctions.ts';

// AsyncDisposableStack hides each failure on a SuppressedError's non-enumerable
// .error / .suppressed. flattenSuppressed pulls them back out so Shutdown can log
// every closer that broke, not just the last one.
describe('flattenSuppressed', () => {
  it('returns every error in a suppressed chain, oldest first', () => {
    const socket = new Error('socket close failed');
    const mongo = new Error('mongo close failed');
    const chain = new SuppressedError(mongo, socket);

    expect(flattenSuppressed(chain).map((e) => (e as Error).message)).toEqual([
      'socket close failed',
      'mongo close failed',
    ]);
  });

  it('returns a lone plain error unchanged', () => {
    const only = new Error('socket close failed');
    expect(flattenSuppressed(only)).toEqual([only]);
  });
});
