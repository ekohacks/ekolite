import { describe, expect, it } from 'vitest';
import { ReactiveStore } from '../../client/reactiveStore.ts';
import { bindStore } from '../../client/reactiveStoreBinding.ts';

// bindStore is the framework-agnostic half of the React hook: the subscribe +
// cached-getSnapshot pair useSyncExternalStore needs. Tested here with no React and
// no DOM, driving a plain ReactiveStore. The hook itself is a thin wrapper over this.
describe('bindStore', () => {
  it('getSnapshot returns a stable reference until the store changes', () => {
    const store = new ReactiveStore();
    const binding = bindStore(store);
    let calls = 0;
    binding.subscribe(() => {
      calls += 1;
    });

    const first = binding.getSnapshot();
    // Same reference across calls, so useSyncExternalStore's Object.is check does not
    // loop. getAll() itself returns a fresh array each call; bindStore caches it.
    expect(binding.getSnapshot()).toBe(first);

    store.handleMessage({ type: 'added', collection: 'files', id: '1', fields: { name: 'a.bam' } });

    expect(calls).toBe(1);
    const second = binding.getSnapshot();
    expect(second).not.toBe(first);
    expect(second).toEqual([{ _id: '1', name: 'a.bam' }]);
  });

  it('unsubscribe stops notifications', () => {
    const store = new ReactiveStore();
    const binding = bindStore(store);
    let calls = 0;
    const unsubscribe = binding.subscribe(() => {
      calls += 1;
    });

    unsubscribe();
    store.handleMessage({ type: 'added', collection: 'files', id: '1', fields: {} });

    expect(calls).toBe(0);
  });
});
