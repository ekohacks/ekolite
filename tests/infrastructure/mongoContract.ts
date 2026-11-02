import { expect, it, vi } from 'vitest';
import type { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import type { ChangeEvent } from '../../shared/types.ts';

// The behaviour every MongoWrapper must honour, real or null (observatory ADR 0023, rule
// three). The unit file runs this list on createNull(), the integration suite on create()
// against a real replica set, so the in-memory collections can never quietly drift from
// Mongo. Every test starts from an empty collection. If the two sides disagree, one of
// these fails.
export const COLLECTION = 'contractDocs';

interface Named {
  _id?: string;
  name: string;
}

export function mongoContract(make: () => MongoWrapper): void {
  const fresh = async (): Promise<MongoWrapper> => {
    const mongo = make();
    await mongo.remove(COLLECTION, {});
    return mongo;
  };

  it('inserts a document and finds it again', async () => {
    const mongo = await fresh();

    await mongo.insert(COLLECTION, { name: 'test.bam' });
    const docs = await mongo.find<Named>(COLLECTION, {});

    expect(docs.map((doc) => doc.name)).toEqual(['test.bam']);
  });

  it('finds only the documents a query matches', async () => {
    const mongo = await fresh();
    await mongo.insert(COLLECTION, { name: 'a' });
    await mongo.insert(COLLECTION, { name: 'b' });

    const docs = await mongo.find<Named>(COLLECTION, { name: 'b' });

    expect(docs.map((doc) => doc.name)).toEqual(['b']);
  });

  it('updates the documents a query matches, and a later find sees the change', async () => {
    const mongo = await fresh();
    await mongo.insert(COLLECTION, { name: 'old' });

    await mongo.update(COLLECTION, { name: 'old' }, { $set: { name: 'new' } });
    const docs = await mongo.find<Named>(COLLECTION, {});

    expect(docs.map((doc) => doc.name)).toEqual(['new']);
  });

  it('removes the documents a query matches and keeps the rest', async () => {
    const mongo = await fresh();
    await mongo.insert(COLLECTION, { name: 'keep' });
    await mongo.insert(COLLECTION, { name: 'remove' });

    await mongo.remove(COLLECTION, { name: 'remove' });
    const docs = await mongo.find<Named>(COLLECTION, {});

    expect(docs.map((doc) => doc.name)).toEqual(['keep']);
  });

  it('tells a watcher about an insert, an update and a remove, each carrying the _id it was given', async () => {
    const mongo = await fresh();
    const changes: ChangeEvent[] = [];
    const stop = await mongo.watchChanges(COLLECTION, (change) => changes.push(change));

    try {
      await mongo.insert(COLLECTION, { _id: 'doc-1', name: 'hello', owner: 'ada' });
      await mongo.update(COLLECTION, { _id: 'doc-1' }, { $set: { name: 'updated' } });
      await mongo.remove(COLLECTION, { _id: 'doc-1' });
      await vi.waitFor(() => {
        expect(changes).toHaveLength(3);
      });

      expect(changes[0]).toEqual({
        type: 'insert',
        collection: COLLECTION,
        id: 'doc-1',
        fields: { name: 'hello', owner: 'ada' },
      });
      // An update carries the whole document as it now stands, unmarked.
      expect(changes[1]).toEqual({
        type: 'update',
        collection: COLLECTION,
        id: 'doc-1',
        fields: { name: 'updated', owner: 'ada' },
      });
      expect(changes[2]).toEqual({ type: 'remove', collection: COLLECTION, id: 'doc-1' });
    } finally {
      await stop();
    }
  });

  it('says nothing about an update or a remove that matched no document', async () => {
    const mongo = await fresh();
    const changes: ChangeEvent[] = [];
    const stop = await mongo.watchChanges(COLLECTION, (change) => changes.push(change));

    try {
      await mongo.update(COLLECTION, { _id: 'ghost' }, { $set: { name: 'x' } });
      await mongo.remove(COLLECTION, { _id: 'ghost' });
      await mongo.insert(COLLECTION, { _id: 'real', name: 'y' });
      await vi.waitFor(() => {
        expect(changes).toHaveLength(1);
      });

      expect(changes[0]).toMatchObject({ type: 'insert', id: 'real' });
    } finally {
      await stop();
    }
  });

  it('counts watchers per collection and lets each one stop', async () => {
    const mongo = await fresh();

    const stop1 = await mongo.watchChanges(COLLECTION, () => undefined);
    const stop2 = await mongo.watchChanges(COLLECTION, () => undefined);
    expect(mongo.watcherCount(COLLECTION)).toBe(2);
    expect(mongo.watcherCount('somewhereElse')).toBe(0);

    await stop1();
    expect(mongo.watcherCount(COLLECTION)).toBe(1);
    await stop2();
    expect(mongo.watcherCount(COLLECTION)).toBe(0);
  });
}
