import { describe, expect, it } from 'vitest';
import { isChangeEvent } from '../../shared/types.ts';

describe('isChangeEvent', () => {
  it('accepts a well formed insert', () => {
    expect(
      isChangeEvent({
        type: 'insert',
        collection: 'files',
        id: 'abc',
        fields: { name: 'one.bam' },
      }),
    ).toBe(true);
  });

  it('accepts a well formed update', () => {
    expect(
      isChangeEvent({
        type: 'update',
        collection: 'files',
        id: 'abc',
        fields: { name: 'two.bam' },
      }),
    ).toBe(true);
  });

  it('accepts a well formed remove', () => {
    expect(
      isChangeEvent({
        type: 'remove',
        collection: 'files',
        id: 'abc',
      }),
    ).toBe(true);
  });

  it('rejects insert without fields', () => {
    expect(
      isChangeEvent({
        type: 'insert',
        collection: 'files',
        id: 'abc',
      }),
    ).toBe(false);
  });

  it('rejects update without fields', () => {
    expect(
      isChangeEvent({
        type: 'update',
        collection: 'files',
        id: 'abc',
      }),
    ).toBe(false);
  });

  it('rejects insert without an id', () => {
    expect(
      isChangeEvent({
        type: 'insert',
        collection: 'files',
        fields: { name: 'one.bam' },
      }),
    ).toBe(false);
  });

  it('rejects insert without a collection', () => {
    expect(
      isChangeEvent({
        type: 'insert',
        id: 'abc',
        fields: { name: 'one.bam' },
      }),
    ).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(isChangeEvent({ type: 'wat', collection: 'files', id: 'abc' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isChangeEvent(null)).toBe(false);
    expect(isChangeEvent(undefined)).toBe(false);
    expect(isChangeEvent('insert')).toBe(false);
    expect(isChangeEvent(42)).toBe(false);
  });
});
