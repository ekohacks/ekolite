import { describe, it, expect } from 'vitest';
import { ReactiveStore } from '../../client/reactiveStore.ts';

describe('ReactiveStore', () => {
  it('inserts a document on added message', () => {
    const store = new ReactiveStore();

    store.handleMessage({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });

    expect(store.getAll()).toEqual([{ _id: '1', name: 'existing.bam' }]);
  });

  it('returns a single document by id', () => {
    const store = new ReactiveStore();

    store.handleMessage({
        type: 'added',
        collection: 'files',
        id: '1',
        fields: { name: 'existing.bam' },
    });

    expect(store.getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
    expect(store.getById('does-not-exist')).toBeUndefined();
  });

  it('calls registered listeners when a document is added', () => {
    const store = new ReactiveStore();
    let callCount = 0;
    store.onChange(() => {
        callCount++;
    });

    store.handleMessage({
        type: 'added',
        collection: 'files',
        id: '1',
        fields: { name: 'existing.bam' },
    });

    expect(callCount).toBe(1);
  });
});
