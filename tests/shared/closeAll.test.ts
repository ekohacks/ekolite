import { describe, expect, it } from 'vitest';
import { closeAll } from '../../shared/helperFunctions.ts';

// closeAll runs a sequence of shutdown steps best-effort: a step that rejects must
// not skip the ones after it (so App.close never drops the Mongo connection just
// because the socket close threw), but the failure is still surfaced so the caller
// can exit non-zero.
describe('closeAll', () => {
  it('runs every step even when an earlier one rejects, then throws the first error', async () => {
    const calls: string[] = [];

    await expect(
      closeAll([
        () => {
          calls.push('a');
          return Promise.resolve();
        },
        () => {
          calls.push('b');
          return Promise.reject(new Error('b failed'));
        },
        () => {
          calls.push('c');
          return Promise.resolve();
        },
      ]),
    ).rejects.toThrow('b failed');

    // c ran despite b rejecting.
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('resolves when every step succeeds', async () => {
    const calls: string[] = [];

    await closeAll([
      () => {
        calls.push('a');
        return Promise.resolve();
      },
      () => {
        calls.push('b');
        return Promise.resolve();
      },
    ]);

    expect(calls).toEqual(['a', 'b']);
  });
});
